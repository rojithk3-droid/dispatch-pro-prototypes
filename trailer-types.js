/* Dispatch Pro — trailer type catalogue + procedural 3D models (no model files).
   Shared by build-asset, security-sensor, axle-weights and tire-pressure-monitor.

   Coordinates (metres): y up, trailer centred on z = 0, FRONT (kingpin / cab) at -z, REAR at +z.
   DPTrailer.TYPES          catalogue [{key,label,icon,desc,axles,...}]
   DPTrailer.label(key)     display name
   DPTrailer.length(key,o)  body length (o.real → true-to-life, otherwise compacted for the axle pages)
   DPTrailer.axles(key,n,o) → { z:[...], steerFirst:bool }  axle centres along z
   DPTrailer.R(key,o)       camera orbit radius the axle pages use
   DPTrailer.build(key,o)   → { root, xr, len, R }
   o = { THREE, RoundedBoxGeometry?, mat:{body,steel,dark,chrome,tail,accent,rubber,skirt,alum,glass,paint}, real?, edges? }
   Each page may call DPTrailer.stored()/save() to remember the subtype chosen per asset. */
(function(root){
  'use strict';

  var TYPES = [
    { key:'dryvan',  label:'Dry Van',   icon:'container',     axles:2, len:16.1, lenC:12.0, rear:1.65, desc:'Enclosed 53′ box for general freight' },
    { key:'reefer',  label:'Reefer',    icon:'snowflake',     axles:2, len:16.1, lenC:12.0, rear:1.65, desc:'Insulated van with a front refrigeration unit' },
    { key:'flatbed', label:'Flat Bed',  icon:'layers',        axles:2, len:14.6, lenC:11.4, rear:1.65, desc:'Open deck with headboard, for steel and lumber' },
    { key:'stepdeck',label:'Step Deck', icon:'chart-no-axes-column-increasing',       axles:2, len:14.6, lenC:11.6, rear:1.65, desc:'Two-level deck for taller loads' },
    { key:'rgn',     label:'RGN',       icon:'arrow-down-to-line', axles:3, len:15.5, lenC:12.4, rear:1.5, desc:'Removable gooseneck, drop deck and rear ramps' },
    { key:'lowboy',  label:'Lowboy',    icon:'arrow-down-wide-narrow', axles:3, len:14.0, lenC:12.0, rear:1.5, desc:'Double-drop deck for heavy, tall machinery' },
    { key:'container',label:'Container',icon:'package',       axles:3, len:12.6, lenC:11.4, rear:1.6, desc:'40′ shipping container on a chassis' },
    { key:'boxtruck',label:'Box Truck', icon:'truck',         axles:2, len:8.0,  lenC:8.0,  rear:1.35, steerFirst:true, desc:'Straight truck with a cargo box' },
    { key:'tanker',  label:'Tanker',    icon:'droplets',      axles:3, len:12.8, lenC:10.8, rear:1.5, desc:'Round bulk-liquid tank' },
    { key:'curtain', label:'Curtain Side', icon:'panel-left', axles:2, len:16.1, lenC:12.0, rear:1.65, desc:'Tarp-sided trailer with side loading' },
    { key:'dump',    label:'End Dump',  icon:'mountain',      axles:3, len:9.8,  lenC:8.6,  rear:1.3, desc:'Tipping tub for aggregate and demolition' }
  ];
  var BY = {}; TYPES.forEach(function(t){ BY[t.key] = t; });
  function def(key){ return BY[key] || BY.dryvan; }
  function label(key){ return def(key).label; }
  function length(key, o){ var t = def(key); return (o && o.real) ? t.len : t.lenC; }
  function R(key, o){ return Math.max(8.4, length(key, o) * 0.78 + 0.2); }

  function axles(key, n, o){
    var t = def(key), L = length(key, o), zf = -L / 2, zr = L / 2, out = [], real = !!(o && o.real);
    n = Math.max(0, n | 0);
    if(t.steerFirst){
      if(n > 0) out.push(zf + 1.35);
      var r = n - 1;
      for(var j = 0; j < r; j++) out.push(zr - t.rear - (r - 1 - j) * 1.3);
      return { z:out, steerFirst:true };
    }
    var rear = real ? Math.max(1.0, t.rear - 0.65) : t.rear;
    var last = zr - rear;
    var sp = real ? Math.max(1.2, Math.min(1.5, 10 / Math.max(1, n - 1)))
                  : (n > 3 ? Math.max(1.1, Math.min(1.3, 8.6 / (n - 1))) : 1.3);
    for(var k = 0; k < n; k++) out.push(last - (n - 1 - k) * sp);
    return { z:out, steerFirst:false };
  }

  /* chosen subtype per asset id, shared across the pages (same origin → same storage) */
  var KEY = 'dp-trailer-types';
  function stored(){ try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){ return {}; } }
  function save(id, type){ try{ var s = stored(); s[id] = type; localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }

  function build(key, o){
    var t = def(key); key = t.key;
    var T = o.THREE, m = o.mat, L = length(key, o), zf = -L / 2, zr = L / 2, xr = [], g = new T.Group();
    var BG = new T.BoxGeometry(1, 1, 1), CG = new T.CylinderGeometry(1, 1, 1, 24);
    var SG = new T.SphereGeometry(1, 24, 14);
    var std = function(c, r, me){ return new T.MeshStandardMaterial({ color:c, roughness:r === undefined ? 0.6 : r, metalness:me || 0 }); };
    var steel = m.steel, dark = m.dark, chrome = m.chrome, tail = m.tail, accent = m.accent || std(0x0F6FFF, 0.4, 0.3);
    var glass = m.glass || std(0x0b1626, 0.1, 0.7), alum = m.alum || steel, rubber = m.rubber || std(0x15181c, 0.95);
    var wood = std(0xa07c52, 0.85), ghost = !!m.body.transparent;

    function put(geo, mat, x, y, z){ var me = new T.Mesh(geo, mat); me.position.set(x || 0, y || 0, z || 0); me.castShadow = me.receiveShadow = true; g.add(me); return me; }
    function box(w, h, d, mat, x, y, z){ var me = put(BG, mat, x, y, z); me.scale.set(w, h, d); return me; }
    function cyl(r, len, mat, x, y, z, axis){
      var me = put(CG, mat, x, y, z); me.scale.set(r, len, r);
      if(axis === 'z') me.rotation.x = Math.PI / 2; else if(axis === 'x') me.rotation.z = Math.PI / 2;
      return me;
    }
    function rb(w, h, d, r, mat, x, y, z){
      return put(o.RoundedBoxGeometry ? new o.RoundedBoxGeometry(w, h, d, 2, r) : new T.BoxGeometry(w, h, d), mat, x, y, z);
    }
    /* a body panel: translucent-capable clone of the page's van material, tinted */
    function body(color, rough, metal){
      var mt = m.body.clone(); if(color != null) mt.color.setHex(color);
      if(rough !== undefined) mt.roughness = rough; if(metal !== undefined) mt.metalness = metal;
      xr.push(['van', mt]); return mt;
    }
    function ghostOff(me){ if(ghost) me.castShadow = false; return me; }
    function edge(me, col){
      if(!o.edges) return;
      var e = new T.LineSegments(new T.EdgesGeometry(me.geometry, 30), new T.LineBasicMaterial({ color:col || 0x0F6FFF, transparent:true, opacity:0.45 }));
      e.position.copy(me.position); e.rotation.copy(me.rotation); e.scale.copy(me.scale); g.add(e);
    }
    /* (z,y) polygon extruded across x (width w, centred on x) */
    function prof(pts, w, mat, x){
      var sh = new T.Shape();
      pts.forEach(function(p, i){ if(i) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
      var ge = new T.ExtrudeGeometry(sh, { depth:w, bevelEnabled:false });
      ge.translate(0, 0, -w / 2); ge.rotateY(-Math.PI / 2);
      return put(ge, mat, x || 0, 0, 0);
    }
    /* a box running from (z0,y0) to (z1,y1) in the z-y plane */
    function slope(w, h, z0, y0, z1, y1, mat, x){
      var d = Math.hypot(z1 - z0, y1 - y0), me = box(w, h, d, mat, x || 0, (y0 + y1) / 2, (z0 + z1) / 2);
      me.rotation.x = Math.atan2(-(y1 - y0), z1 - z0); return me;
    }
    function many(n, mat, fn){
      var im = new T.InstancedMesh(BG, mat, n), d = new T.Object3D();
      for(var i = 0; i < n; i++){ d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); fn(d, i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
      im.castShadow = false; g.add(im); return im;
    }

    /* ---------- shared running gear ---------- */
    function rails(z0, z1, y, x){ var len = z1 - z0; [-1, 1].forEach(function(s){ box(.16, .3, len, dark, s * (x || .45), y === undefined ? .92 : y, (z0 + z1) / 2); }); }
    function cross(z0, z1, y, step, w){ for(var z = z0; z <= z1; z += step) box(w || 1.0, .1, .1, dark, 0, y === undefined ? .9 : y, z); }
    function kingpin(z, y){ cyl(.45, .06, steel, 0, y === undefined ? 1.0 : y, z); cyl(.09, .3, chrome, 0, (y === undefined ? 1.0 : y) - .08, z); }
    function landing(z){ [-.95, .95].forEach(function(x){ box(.14, .95, .14, steel, x, .52, z); box(.5, .06, .4, dark, x, .05, z); }); }
    function rearGear(z, bumperY){
      box(2.4, .26, .12, dark, 0, bumperY === undefined ? .62 : bumperY, z + .15);
      [-1.05, 1.05].forEach(function(x){ rb(.3, .12, .06, .02, tail, x, 1.05, z + .12); });
    }
    function flaps(z){ [-.95, .95].forEach(function(x){ box(.05, .55, .85, rubber, x, .62, z); }); }
    function skirts(z0, z1){ [-1, 1].forEach(function(s){ box(.04, .5, z1 - z0, m.skirt || dark, s * 1.28, .9, (z0 + z1) / 2); }); }
    var ax = axles(key, t.axles, o).z, lastAx = ax.length ? ax[ax.length - 1] : zr - t.rear;

    /* ---------- the models ---------- */
    function vanLike(color, o2){
      rails(zf, zr, .92); cross(zf + .6, zr - .5, .9, .9);
      box(2.6, .08, L, steel, 0, 1.12, 0);
      var van = rb(2.6, o2.h || 2.7, L, .05, o2.mat || m.body, 0, 1.15 + (o2.h || 2.7) / 2, 0); ghostOff(van);
      if(!o2.mat) xr.push(['van', m.body]); edge(van);
      kingpin(zf + .7); landing(zf + 2.6);
      rearGear(zr, .62); flaps(lastAx + .75); skirts(zf + 4.2, lastAx - 1.1);
      box(2.4, .03, .03, accent, 0, 3.55, zf + .45);
      return van;
    }
    function rearDoors(zEnd, yMid, h){
      box(.03, h, .04, dark, 0, yMid, zEnd + .01);
      [-1, 1].forEach(function(s){ [.25, .6, .95].forEach(function(dx){ cyl(.018, h - .1, chrome, s * dx, yMid, zEnd + .04); }); });
    }

    if(key === 'dryvan'){
      var v = vanLike(0xe9eef5, {});
      var rib = body(0xcfd8e3, .5, .05);
      var nr = Math.floor((L - .6) / .36);
      many(nr * 2, rib, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.302, 2.5, zf + .5 + k * .36); d.scale.set(.014, 2.55, .03); });
      rearDoors(zr, 2.5, 2.5);
      [-1, 1].forEach(function(s){ box(.1, 2.5, .05, steel, s * 1.28, 2.5, zr + .005); });
    }

    else if(key === 'reefer'){
      var wh = body(0xf4f7fa, .45, .02);
      var rf = vanLike(0xf4f7fa, { mat:wh, h:2.78 });
      box(2.64, .1, L, alum, 0, 1.2, 0);                                  // aluminium bottom rail
      var unit = std(0xb7c0cb, .5, .5);
      box(2.1, 1.5, .55, unit, 0, 3.3, zf - .28);                           // refrigeration unit on the nose
      for(var i = 0; i < 7; i++) box(1.7, .025, .04, dark, 0, 2.7 + i * .11, zf - .57);
      box(.5, .5, .06, accent, .6, 3.8, zf - .57);
      box(2.1, .08, .6, steel, 0, 2.55, zf - .28);
      var tank = put(new T.CapsuleGeometry(.3, 1.1, 6, 14), std(0x9ea6b0, .35, .7), -1.02, .7, zf + 4.6); tank.rotation.x = Math.PI / 2;
      rearDoors(zr, 2.55, 2.5);
      var stripe = box(2.62, .12, L - .4, body(0x0F6FFF, .5, .1), 0, 2.2, 0); stripe.castShadow = false;   // blue belt stripe
    }

    else if(key === 'flatbed' || key === 'stepdeck'){
      var up = key === 'stepdeck', U = up ? Math.min(4.2, L * .3) : 0, hi = up ? 1.62 : 1.34, lo = up ? 1.12 : 1.34;
      /* frame */
      rails(zf, zr, up ? 0 : lo - .45, .6);
      if(up){
        [-1, 1].forEach(function(s){
          box(.18, .34, U, steel, s * .6, hi - .22, zf + U / 2);
          slope(.18, .34, zf + U, hi - .22, zf + U + .8, lo - .22, steel, s * .6);
          box(.18, .34, L - U - .8, steel, s * .6, lo - .22, zf + U + .8 + (L - U - .8) / 2);
        });
        for(var z1 = zf + .7; z1 < zf + U; z1 += .85) box(2.4, .1, .1, dark, 0, hi - .3, z1);
        for(var z2 = zf + U + 1.2; z2 < zr - .3; z2 += .85) box(2.4, .1, .1, dark, 0, lo - .3, z2);
        box(2.6, .1, U, wood, 0, hi - .05, zf + U / 2);
        slope(2.6, .1, zf + U, hi - .05, zf + U + .8, lo - .05, wood, 0);
        box(2.6, .1, L - U - .8, wood, 0, lo - .05, zf + U + .8 + (L - U - .8) / 2);
        // rub rails
        [-1, 1].forEach(function(s){
          box(.08, .12, U, steel, s * 1.3, hi, zf + U / 2);
          box(.08, .12, L - U - .8, steel, s * 1.3, lo, zf + U + .8 + (L - U - .8) / 2);
          slope(.08, .12, zf + U, hi, zf + U + .8, lo, steel, s * 1.3);
        });
        many(Math.floor(U / .75) * 2, steel, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.3, hi - .04, zf + .5 + k * .75); d.scale.set(.1, .14, .1); });
        many(Math.floor((L - U - 1) / .75) * 2, steel, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.3, lo - .04, zf + U + 1.2 + k * .75); d.scale.set(.1, .14, .1); });
      } else {
        [-1, 1].forEach(function(s){ box(.18, .34, L, steel, s * .6, lo - .22, 0); box(.08, .12, L, steel, s * 1.3, lo, 0); });
        for(var z3 = zf + .6; z3 < zr - .2; z3 += .85) box(2.4, .1, .1, dark, 0, lo - .3, z3);
        box(2.6, .1, L, wood, 0, lo - .05, 0);
        many(Math.floor((L - .6) / .75) * 2, steel, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.3, lo - .04, zf + .5 + k * .75); d.scale.set(.1, .14, .1); });
      }
      /* headboard */
      var hy = hi + .05;
      [-1.2, -.6, 0, .6, 1.2].forEach(function(x){ box(.07, 1.1, .07, steel, x, hy + .55, zf + .1); });
      [.35, .75, 1.1].forEach(function(dy){ box(2.55, .07, .07, steel, 0, hy + dy, zf + .1); });
      box(2.6, .08, .1, steel, 0, hy + 1.12, zf + .1);
      kingpin(zf + .7, hi - .5); landing(zf + (up ? U + 1.6 : 2.8));
      box(.5, .42, .9, dark, -1.0, (up ? lo : lo) - .62, up ? zf + U + 2.4 : zf + 3.4);   // tool box
      rearGear(zr, up ? .75 : .82); flaps(lastAx + .75);
      /* a few straps/chains hanging at the edge */
      [-1, 1].forEach(function(s){ for(var cz = zf + 2.2; cz < zr - 1; cz += 2.6) cyl(.012, .22, chrome, s * 1.35, lo - .12, cz, 'x'); });
    }

    else if(key === 'rgn' || key === 'lowboy'){
      var dk = std(0x3a4048, .6, .5);
      var well = key === 'rgn' ? .78 : .8, deck = 1.18;
      var wz0 = zf + 3.2, wz1 = zr - 4.9, rz = zr - 1.0;
      if(key === 'rgn'){
        /* two removable-neck arms + the main deck beam */
        [-.8, .8].forEach(function(x){
          prof([[zf + .1,1.35],[zf + .9,1.72],[zf + 1.8,1.55],[zf + 2.6,1.1],[zf + 3.3,.88],[zf + 3.5,.88],[zf + 3.5,.62],[zf + 3.2,.62],[zf + 2.4,.9],[zf + 1.7,1.3],[zf + .9,1.42],[zf + .1,1.15]], .24, dk, x);
        });
        box(1.9, .3, .45, steel, 0, 1.3, zf + .3); kingpin(zf + .4, 1.12);
        slope(.14, .14, zf + 1.2, 1.12, zf + 2.6, .82, chrome, -.4); slope(.14, .14, zf + 1.2, 1.12, zf + 2.6, .82, chrome, .4);   // hydraulic rams
        box(.04, .5, .32, accent, 0, .9, zf + 3.5);                       // detach joint
        [-1, 1].forEach(function(s){ slope(.7, .06, rz - .2, deck - .1, zr + 1.1, .08, steel, s * .75); });   // lowered loading ramps
        landing(zf + 3.0);
        prof([[zf + 3.5,well + .02],[wz1,well + .02],[wz1 + .7,deck],[rz,deck],[zr,.9],[zr,.72],[rz,1.03],[wz1 + .7,1.03],[wz1,.62],[zf + 3.5,.62]], 2.5, dk, 0);
      } else {
        prof([[zf,1.37],[zf + 2.2,1.37],[zf + 2.8,well + .02],[wz1,well + .02],[wz1 + .6,deck],[zr,deck],[zr,1.03],[wz1 + .6,1.03],[wz1,.64],[zf + 2.9,.64],[zf + 2.3,1.19],[zf,1.19]], 2.5, dk, 0);
        kingpin(zf + .7, 1.12); landing(zf + 1.9);
        box(2.2, .12, 2.2, steel, 0, 1.43, zf + 1.1);                     // upper deck
        [-1, 1].forEach(function(s){ box(.1, .5, 2.2, steel, s * 1.15, 1.7, zf + 1.1); });
        box(2.6, .5, .1, steel, 0, 1.7, zf + .05);                          // headboard
      }
      /* planked decks */
      box(2.4, .05, wz1 - (zf + 3.4), wood, 0, well + .075, (zf + 3.4 + wz1) / 2);
      box(2.4, .05, rz - (wz1 + .8), wood, 0, deck + .025, (wz1 + .8 + rz) / 2);
      many(Math.floor((rz - wz1) / .8) * 2, steel, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.28, deck, wz1 + .9 + k * .8); d.scale.set(.1, .16, .1); });
      many(Math.floor((wz1 - wz0) / .8) * 2, steel, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.28, well + .02, wz0 + .3 + k * .8); d.scale.set(.1, .16, .1); });
      rearGear(zr, .72); flaps(lastAx + .75);
    }

    else if(key === 'container'){
      var cL = L - .4, cH = 2.9, cy0 = 1.28, cb = body(0x2f6ea5, .55, .35);
      rails(zf, zr, .9, .5);
      cross(zf + 1.0, zr - .6, .88, .95, 1.1);
      box(1.4, .3, 1.8, dark, 0, 1.0, zf + .9);                           // gooseneck
      kingpin(zf + .75, 1.14); landing(zf + 3.0);
      [-1.1, 1.1].forEach(function(x){ [zf + .5, zf + L * .5, zr - .5].forEach(function(z){ box(.22, .14, .22, steel, x, 1.06, z); }); });
      var ct = rb(2.44, cH, cL, .02, cb, 0, cy0 + cH / 2, 0); ghostOff(ct); edge(ct, 0x1b4f7c);
      var ridge = body(0x275b88, .6, .3);
      var nc = Math.floor(cL / .22);
      many(nc * 2, ridge, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.235, cy0 + cH / 2, -cL / 2 + .25 + k * .22); d.scale.set(.03, cH - .3, .08); });
      many(Math.floor(nc / 2), ridge, function(d, i){ d.position.set(0, cy0 + cH + .01, -cL / 2 + .25 + i * .44); d.scale.set(2.2, .03, .1); });
      var c8 = [-1, 1];
      c8.forEach(function(sx){ c8.forEach(function(sz){ [cy0 + .08, cy0 + cH - .08].forEach(function(y){ box(.2, .16, .2, steel, sx * 1.16, y, sz * (cL / 2 - .1)); }); }); });
      c8.forEach(function(s){ box(.07, .08, cL, steel, s * 1.2, cy0 + cH - .04, 0); box(.07, .1, cL, steel, s * 1.2, cy0 + .05, 0); });
      [-.9, -.3, .3, .9].forEach(function(x){ cyl(.02, cH - .2, chrome, x, cy0 + cH / 2, zr - .2 + .01); });     // door locking rods
      box(.04, cH - .1, .04, dark, 0, cy0 + cH / 2, zr - .2 + .02);
      box(2.4, .26, .12, dark, 0, .62, zr + .1); [-1.05, 1.05].forEach(function(x){ rb(.3, .12, .06, .02, tail, x, 1.05, zr + .07); });
      flaps(lastAx + .75);
    }

    else if(key === 'boxtruck'){
      var cabL = 2.15, bL = L - cabL - .15, bc = zf + cabL + .15 + bL / 2, paint = m.paint || m.body;
      rails(zf + .5, zr, .82, .5); cross(zf + 1.2, zr - .3, .8, 1.0, 1.0);
      box(2.4, .1, L - cabL, steel, 0, 1.1, zf + cabL + (L - cabL) / 2);
      /* cab (cab-over) */
      var cab = prof([[zf,.85],[zf,2.5],[zf + .35,3.1],[zf + 1.9,3.15],[zf + cabL,3.1],[zf + cabL,.85]], 2.3, paint, 0);
      box(2.0, .95, .05, glass, 0, 2.75, zf + .12).rotation.x = -.3;
      [-1, 1].forEach(function(s){ box(.04, .75, 1.1, glass, s * 1.16, 2.6, zf + 1.05); box(.04, .06, 1.1, steel, s * 1.16, 2.2, zf + 1.05); });
      box(2.1, .5, .05, dark, 0, 1.45, zf - .01);                           // grille
      [-1, 1].forEach(function(s){ rb(.4, .22, .08, .03, m.lamp || chrome, s * .88, 1.45, zf - .03); box(.1, .5, .12, dark, s * 1.25, 2.9, zf + .55); });
      box(2.35, .32, .3, chrome, 0, .68, zf - .1);
      /* cargo box */
      var bb = rb(2.5, 2.5, bL, .05, m.body, 0, 1.15 + 1.25, bc); ghostOff(bb); xr.push(['van', m.body]); edge(bb);
      many(Math.floor((bL - .4) / .5), body(0xcfd8e3, .5, .05), function(d, i){ d.position.set(0, 2.4, zr - .35 - i * .5); d.scale.set(2.52, .02, .04); d.position.x = 0; });
      /* rear roll-up door + step + lights */
      for(var rd = 0; rd < 9; rd++) box(2.3, .02, .02, dark, 0, 1.45 + rd * .26, zr + .03);
      box(2.4, .26, .12, dark, 0, .55, zr + .1);
      [-1.05, 1.05].forEach(function(x){ rb(.3, .12, .06, .02, tail, x, 1.05, zr + .07); });
      var ftank = put(new T.CapsuleGeometry(.28, 1.0, 6, 14), std(0x9ea6b0, .35, .7), -1.0, .6, 0); ftank.rotation.x = Math.PI / 2;
      flaps(lastAx + .75);
    }

    else if(key === 'tanker'){
      var tb = body(0xd2d9e0, .28, .85), tlen = L - .9, ry = 1.2 + 1.05;
      rails(zf, zr, .92); cross(zf + .7, zr - .5, .9, 1.4);
      var tk = put(CG, tb, 0, ry, 0); tk.scale.set(1.25, tlen, 1.05); tk.rotation.x = Math.PI / 2; ghostOff(tk);
      [-1, 1].forEach(function(s){ var cap = put(SG, tb, 0, ry, s * tlen / 2); cap.scale.set(1.25, 1.05, .5); ghostOff(cap); });
      [-1, 0, 1].forEach(function(k){ var ring = put(CG, steel, 0, ry, k * tlen / 3.4); ring.scale.set(1.27, .06, 1.07); ring.rotation.x = Math.PI / 2; });
      [-3, -1, 1, 3].forEach(function(k){ cyl(.34, .18, steel, 0, ry + 1.07, k * tlen / 7.6); cyl(.12, .24, dark, 0, ry + 1.17, k * tlen / 7.6); });
      box(.6, .04, tlen - 1.2, steel, 0, ry + 1.06, 0);                    // walkway
      [-1, 1].forEach(function(s){ box(.03, .22, tlen - 1.2, steel, s * .3, ry + 1.18, 0); });
      box(1.7, .85, .5, dark, 0, 1.55, zr - .15);                            // valve cabinet
      [-.5, 0, .5].forEach(function(x){ cyl(.07, .5, chrome, x, 1.0, zr + .2, 'z'); });
      [-1, 1].forEach(function(s){ box(.05, 1.8, .04, steel, s * .4, 2.2, zr + .1); });
      [.3, .7, 1.1, 1.5, 1.9].forEach(function(y){ box(.8, .03, .04, steel, 0, 1.3 + y, zr + .1); });
      [-1, 1].forEach(function(s){ box(.5, .4, .4, steel, s * 1.0, 1.1, zf + 2.4); });
      kingpin(zf + .7); landing(zf + 2.6);
      rearGear(zr, .62); flaps(lastAx + .75);
    }

    else if(key === 'curtain'){
      var cu = body(0x3f6aa8, .8, 0), ch = 2.5;
      rails(zf, zr, .92, .6); cross(zf + .6, zr - .5, .9, .9);
      box(2.6, .1, L, wood, 0, 1.17, 0); [-1, 1].forEach(function(s){ box(.08, .12, L, steel, s * 1.3, 1.2, 0); });
      var cs = rb(2.58, ch, L - .2, .06, cu, 0, 1.55 + ch / 2, 0); ghostOff(cs); edge(cs, 0x233f6b);
      var pleat = body(0x5b87c4, .85, 0), np = Math.floor((L - .6) / .22);
      many(np * 2, pleat, function(d, i){ var s = i % 2 ? 1 : -1, k = (i / 2) | 0; d.position.set(s * 1.3, 1.55 + ch / 2, zf + .4 + k * .22); d.scale.set(.03, ch - .08, .05); });
      [-1, 1].forEach(function(s){
        box(.08, .12, L - .1, steel, s * 1.3, 1.55 + ch + .04, 0);          // top rail
        for(var k = 0; k < 8; k++){ box(.04, .09, .24, dark, s * 1.31, 1.55 + ch * (.3 + (k % 2) * .4), zf + 1.2 + k * ((L - 2.4) / 7)); }
        box(.04, .16, L - .2, steel, s * 1.31, 1.62, 0);                    // bottom strap line
      });
      [-1.2, -.4, .4, 1.2].forEach(function(x){ box(.07, ch + .3, .07, steel, x, 1.4 + ch / 2, zf + .12); });
      box(2.6, .08, .1, steel, 0, 1.55 + ch + .1, zf + .1);
      [-1, 1].forEach(function(s){ box(.1, ch + .1, .08, steel, s * 1.25, 1.55 + ch / 2, zr - .05); });
      box(2.6, .1, .1, steel, 0, 1.55 + ch + .05, zr - .05);
      kingpin(zf + .7); landing(zf + 2.6);
      rearGear(zr, .62); flaps(lastAx + .75); skirts(zf + 4.2, lastAx - 1.1);
    }

    else if(key === 'dump'){
      var db = body(0xd9a21a, .5, .25);
      rails(zf, zr, .95, .6); cross(zf + .6, zr - .4, .93, .9, 1.2);
      var tub = L - .6, tz = zf + .3 + tub / 2 + .15;
      var fl = box(2.4, .14, tub, db, 0, 1.38, tz); ghostOff(fl);
      [-1, 1].forEach(function(s){ var sd = box(.1, 2.15, tub, db, s * 1.25, 2.4, tz); ghostOff(sd); box(.14, .14, tub, steel, s * 1.25, 3.5, tz);
        for(var k = 0; k < 6; k++) box(.05, 2.1, .08, steel, s * 1.31, 2.4, zf + 1.3 + k * (tub - 1.3) / 5.4); });
      var fw = box(2.5, 2.4, .1, db, 0, 2.55, zf + .35); ghostOff(fw);
      var cs2 = slope(2.5, .1, zf + .35, 3.75, zf + 1.6, 3.5, db, 0); ghostOff(cs2); box(2.5, .5, .1, db, 0, 3.55, zf + .35);   // cab shield
      var tg = box(2.4, 2.0, .08, db, 0, 2.4, zr - .3); ghostOff(tg);
      box(2.4, .08, .08, steel, 0, 3.45, zr - .3); cyl(.06, .3, steel, 1.1, 3.4, zr - .3, 'x');
      var load = put(SG, std(0x77705f, .95), 0, 1.5, tz + .2); load.scale.set(1.1, .9, tub * .42); load.position.y = 1.5; load.castShadow = false;
      slope(.2, .2, zf + 1.1, .9, zf + 1.45, 2.0, chrome, 0); slope(.28, .28, zf + 1.1, .9, zf + 1.2, 1.2, steel, 0);   // hoist ram
      kingpin(zf + .7); landing(zf + 2.7);
      rearGear(zr, .65); flaps(lastAx + .7);
    }

    return { root:g, xr:xr, len:L, R:R(key, o), tY:1.4 };
  }

  root.DPTrailer = { TYPES:TYPES, def:def, label:label, length:length, axles:axles, R:R, build:build, stored:stored, save:save, STORAGE_KEY:KEY };
})(window);
