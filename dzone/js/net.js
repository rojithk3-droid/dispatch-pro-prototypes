// Networking: a tiny pub/sub transport plus the social layer (presence, friends, party, invites, match browser).
// Transport is the PowerShell WebSocket relay when the game is served by it, otherwise BroadcastChannel,
// which links every tab of this browser, so two tabs can play together with no server at all.

const LS = {
  get(k, d) { try { const v = localStorage.getItem('br.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('br.' + k, JSON.stringify(v)); } catch {} },
};
export { LS };

export const uid = () => Math.random().toString(36).slice(2, 10);

class Transport {
  constructor() {
    this.mode = 'offline';
    this.listeners = new Map();   // channel -> Set(fn)
    this.bcs = new Map();         // channel -> BroadcastChannel (local mode)
    this.ws = null;
    this.queue = [];
    this.onStatus = () => {};
  }

  async connect(customUrl) {
    const url = customUrl || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    if (location.protocol.startsWith('http')) {
      const ok = await new Promise((res) => {
        let done = false;
        try {
          const ws = new WebSocket(url);
          const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} res(false); } }, 1800);
          ws.onopen = () => { if (done) return; done = true; clearTimeout(t); this.ws = ws; res(true); };
          ws.onerror = () => { if (done) return; done = true; clearTimeout(t); res(false); };
        } catch { res(false); }
      });
      if (ok) {
        this.mode = 'relay';
        this.url = url;
        this.ws.onmessage = (e) => this._onWs(e.data);
        this.ws.onclose = () => { this.mode = 'local'; this.ws = null; this._resubLocal(); this.onStatus(this.mode); };
        for (const ch of this.listeners.keys()) this.ws.send('S ' + ch);
        this.onStatus(this.mode);
        return this.mode;
      }
    }
    this.mode = typeof BroadcastChannel !== 'undefined' ? 'local' : 'offline';
    this._resubLocal();
    this.onStatus(this.mode);
    return this.mode;
  }

  _resubLocal() {
    if (this.mode !== 'local') return;
    for (const ch of this.listeners.keys()) this._bc(ch);
  }

  _bc(ch) {
    if (this.bcs.has(ch)) return this.bcs.get(ch);
    const bc = new BroadcastChannel('dzone:' + ch);
    bc.onmessage = (e) => this._deliver(ch, e.data);
    this.bcs.set(ch, bc);
    return bc;
  }

  _onWs(text) {
    const nl = text.indexOf('\n');
    if (nl < 0 || text[0] !== 'M') return;
    const ch = text.slice(2, nl).trim();
    let obj; try { obj = JSON.parse(text.slice(nl + 1)); } catch { return; }
    this._deliver(ch, obj);
  }

  _deliver(ch, obj) {
    const set = this.listeners.get(ch);
    if (set) for (const fn of set) { try { fn(obj); } catch (e) { console.error(e); } }
  }

  sub(ch, fn) {
    let set = this.listeners.get(ch);
    const fresh = !set;
    if (!set) { set = new Set(); this.listeners.set(ch, set); }
    set.add(fn);
    if (fresh) {
      if (this.mode === 'relay' && this.ws) this.ws.send('S ' + ch);
      else if (this.mode === 'local') this._bc(ch);
    }
    return () => this.unsub(ch, fn);
  }

  unsub(ch, fn) {
    const set = this.listeners.get(ch);
    if (!set) return;
    if (fn) set.delete(fn); else set.clear();
    if (set.size) return;
    this.listeners.delete(ch);
    if (this.mode === 'relay' && this.ws) this.ws.send('U ' + ch);
    const bc = this.bcs.get(ch);
    if (bc) { bc.close(); this.bcs.delete(ch); }
  }

  pub(ch, obj) {
    if (this.mode === 'relay' && this.ws && this.ws.readyState === 1) this.ws.send('P ' + ch + '\n' + JSON.stringify(obj));
    else if (this.mode === 'local') this._bc(ch).postMessage(obj);
  }
}

export const net = new Transport();

// ---------------------------------------------------------------- social layer
// Presence lives on the "lobby" channel; every player also listens on "u:<id>" for direct messages.
export class Social extends EventTarget {
  constructor() {
    super();
    this.me = null;              // {id, name, outfit}
    this.online = new Map();     // id -> {id, name, status, party, map, seen}
    this.friends = new Set(LS.get('friends', []));
    this.party = null;           // {id, leader, members:[{id,name,outfit,ready}], map, mode}
    this.matchAds = new Map();   // matchId -> ad
    this.status = 'menu';
    this._hb = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async login(name, outfit) {
    const tryName = name.trim().slice(0, 16);
    const id = uid();
    this.me = { id, name: tryName, outfit };
    this.nameTaken = false;
    net.sub('u:' + id, (m) => this._direct(m));
    net.sub('lobby', (m) => this._lobby(m));
    net.pub('lobby', { t: 'hello', ...this._pres() });
    // give anyone holding this name a moment to object
    await new Promise((r) => setTimeout(r, net.mode === 'offline' ? 0 : 450));
    if (this.nameTaken) {
      net.unsub('u:' + id); net.unsub('lobby');
      this.me = null;
      return { ok: false, error: 'That username is online right now. Pick another.' };
    }
    LS.set('name', tryName);
    this.createParty();
    clearInterval(this._hb);
    this._hb = setInterval(() => this._heartbeat(), 4000);
    return { ok: true };
  }

  _pres() {
    return { id: this.me.id, name: this.me.name, status: this.status, party: this.party ? this.party.id : null,
      psize: this.party ? this.party.members.length : 1, outfit: this.me.outfit };
  }

  _heartbeat() {
    if (!this.me) return;
    net.pub('lobby', { t: 'pres', ...this._pres() });
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.online) if (now - p.seen > 13000) { this.online.delete(id); changed = true; }
    for (const [id, a] of this.matchAds) if (now - a.seen > 9000) { this.matchAds.delete(id); changed = true; }
    if (changed) { this.emit('presence'); this.emit('ads'); }
    // leader keeps party members fresh; members notice a vanished leader
    if (this.party && this.party.leader === this.me.id) this._pushParty();
    else if (this.party && this.party.leader !== this.me.id && !this.online.has(this.party.leader) && this.party.members.length > 1) {
      this.emit('toast', { text: 'Party leader went offline. You are on your own now.' });
      this.createParty();
    }
  }

  setStatus(s) { this.status = s; if (this.me) net.pub('lobby', { t: 'pres', ...this._pres() }); }

  setOutfit(o) { if (this.me) { this.me.outfit = o; if (this.party) { const m = this.party.members.find((x) => x.id === this.me.id); if (m) m.outfit = o; this._partyChanged(); } } }

  _lobby(m) {
    if (!this.me || m.id === this.me.id) return;
    if (m.t === 'hello' || m.t === 'pres') {
      if (m.t === 'hello' && m.name.toLowerCase() === this.me.name.toLowerCase()) {
        net.pub('u:' + m.id, { t: 'nametaken' });
        return;
      }
      const known = this.online.has(m.id);
      this.online.set(m.id, { ...m, seen: Date.now() });
      if (m.t === 'hello') net.pub('u:' + m.id, { t: 'pres', ...this._pres() });
      if (!known && this.friends.has(m.name.toLowerCase())) this.emit('toast', { text: `${m.name} is online` });
      this.emit('presence');
    } else if (m.t === 'bye') {
      this.online.delete(m.id); this.emit('presence');
    } else if (m.t === 'matchAd') {
      this.matchAds.set(m.matchId, { ...m, seen: Date.now() }); this.emit('ads');
    } else if (m.t === 'matchGone') {
      this.matchAds.delete(m.matchId); this.emit('ads');
    }
  }

  _direct(m) {
    if (m.t === 'nametaken') { this.nameTaken = true; return; }
    if (m.t === 'pres') { this.online.set(m.id, { ...m, seen: Date.now() }); this.emit('presence'); return; }
    if (m.t === 'invite') { this.emit('invite', m); return; }
    if (m.t === 'inviteReply') {
      if (!m.accept) this.emit('toast', { text: `${m.name} declined your invite` });
      return;
    }
    if (m.t === 'joinReq' && this.party && this.party.leader === this.me.id) {
      if (this.party.members.length >= 4) { net.pub('u:' + m.id, { t: 'partyFull' }); return; }
      if (!this.party.members.find((x) => x.id === m.id)) this.party.members.push({ id: m.id, name: m.name, outfit: m.outfit, ready: false });
      this._partyChanged();
      this.emit('toast', { text: `${m.name} joined your squad` });
      return;
    }
    if (m.t === 'partyFull') { this.emit('toast', { text: 'That squad is full (4/4).' }); return; }
    if (m.t === 'kicked') { this.emit('toast', { text: 'You were removed from the squad.' }); this.createParty(); return; }
    if (m.t === 'whisper') { this.emit('chat', { from: m.name, text: m.text, whisper: true }); return; }
  }

  search(q) {
    q = q.trim().toLowerCase();
    const res = [];
    for (const p of this.online.values()) if (!q || p.name.toLowerCase().includes(q)) res.push(p);
    res.sort((a, b) => a.name.localeCompare(b.name));
    return res;
  }

  isFriend(name) { return this.friends.has(name.toLowerCase()); }
  toggleFriend(name) {
    const k = name.toLowerCase();
    if (this.friends.has(k)) this.friends.delete(k); else this.friends.add(k);
    LS.set('friends', [...this.friends]);
    this.emit('presence');
  }
  friendList() {
    const out = [];
    for (const f of this.friends) {
      const on = [...this.online.values()].find((p) => p.name.toLowerCase() === f);
      out.push(on ? { ...on, online: true } : { name: f, online: false });
    }
    return out.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  }

  // ---- party
  createParty() {
    if (this.party) net.unsub('p:' + this.party.id);
    const map = this.party ? this.party.map : LS.get('map', 'bangalore');
    const mode = this.party ? this.party.mode : 'squad';
    this.party = { id: uid(), leader: this.me.id, members: [{ id: this.me.id, name: this.me.name, outfit: this.me.outfit, ready: true }], map, mode };
    net.sub('p:' + this.party.id, (m) => this._partyMsg(m));
    this._partyChanged(true);
  }

  isLeader() { return this.party && this.party.leader === this.me.id; }

  invite(p) {
    if (!this.isLeader()) { this.emit('toast', { text: 'Only the squad leader can invite.' }); return; }
    net.pub('u:' + p.id, { t: 'invite', from: this.me.id, name: this.me.name, party: this.party.id, map: this.party.map, size: this.party.members.length });
    this.emit('toast', { text: `Invite sent to ${p.name}` });
  }

  acceptInvite(inv) {
    if (this.party) net.unsub('p:' + this.party.id);
    this.party = { id: inv.party, leader: inv.from, members: [], map: inv.map, mode: 'squad' };
    net.sub('p:' + this.party.id, (m) => this._partyMsg(m));
    net.pub('u:' + inv.from, { t: 'joinReq', id: this.me.id, name: this.me.name, outfit: this.me.outfit });
    net.pub('u:' + inv.from, { t: 'inviteReply', accept: true, name: this.me.name });
    this.setStatus('in squad');
  }

  declineInvite(inv) { net.pub('u:' + inv.from, { t: 'inviteReply', accept: false, name: this.me.name }); }

  leaveParty() {
    if (!this.party) return;
    if (!this.isLeader()) net.pub('p:' + this.party.id, { t: 'leave', id: this.me.id });
    else if (this.party.members.length > 1) {
      // hand leadership to the next member
      this.party.members = this.party.members.filter((m) => m.id !== this.me.id);
      this.party.leader = this.party.members[0].id;
      this._pushParty();
    }
    this.createParty();
  }

  kick(id) { if (!this.isLeader()) return; this.party.members = this.party.members.filter((m) => m.id !== id); net.pub('u:' + id, { t: 'kicked' }); this._partyChanged(); }

  setPartyMap(map) { if (!this.isLeader()) return; this.party.map = map; LS.set('map', map); this._partyChanged(); }
  setPartyMode(mode) { if (!this.isLeader()) return; this.party.mode = mode; this._partyChanged(); }
  setReady(r) {
    const m = this.party.members.find((x) => x.id === this.me.id);
    if (m) m.ready = r;
    if (this.isLeader()) this._partyChanged(); else net.pub('p:' + this.party.id, { t: 'ready', id: this.me.id, ready: r });
    this.emit('party');
  }

  partyChat(text) {
    if (!text.trim()) return;
    net.pub('p:' + this.party.id, { t: 'chat', name: this.me.name, text: text.slice(0, 160) });
    this.emit('chat', { from: this.me.name, text: text.slice(0, 160) });
  }

  _partyChanged(silent) { if (this.isLeader()) this._pushParty(); this.emit('party'); if (!silent) this.setStatus(this.party.members.length > 1 ? 'in squad' : 'menu'); }
  _pushParty() { net.pub('p:' + this.party.id, { t: 'party', party: this.party }); }

  _partyMsg(m) {
    if (!this.party) return;
    if (m.t === 'party') {
      if (!m.party.members.find((x) => x.id === this.me.id)) return;
      this.party = m.party; this.emit('party');
    } else if (m.t === 'leave' && this.isLeader()) {
      this.party.members = this.party.members.filter((x) => x.id !== m.id); this._partyChanged();
    } else if (m.t === 'ready' && this.isLeader()) {
      const x = this.party.members.find((q) => q.id === m.id); if (x) x.ready = m.ready; this._partyChanged();
    } else if (m.t === 'chat') {
      this.emit('chat', { from: m.name, text: m.text });
    } else if (m.t === 'launch') {
      this.emit('launch', m);
    }
  }

  // leader tells the squad to load into a match
  launch(info) { net.pub('p:' + this.party.id, { t: 'launch', ...info }); }

  advertise(ad) { net.pub('lobby', { t: 'matchAd', ...ad }); }
  unadvertise(matchId) { net.pub('lobby', { t: 'matchGone', matchId }); }

  logout() {
    if (!this.me) return;
    net.pub('lobby', { t: 'bye', id: this.me.id });
  }
}
