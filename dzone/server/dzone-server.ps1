# DZone relay server.
# Serves the game (static files) and relays WebSocket pub/sub messages between players.
# No Node, no Python: HttpListener + WebSockets via inline C#, Windows PowerShell 5.1+.
#
#   powershell -ExecutionPolicy Bypass -File dzone\server\dzone-server.ps1            (this PC only)
#   powershell -ExecutionPolicy Bypass -File dzone\server\dzone-server.ps1 -Lan       (whole LAN, run as admin once)
#
# LAN mode binds http://+:PORT/ which Windows only allows for admins, or after a one-time:
#   netsh http add urlacl url=http://+:8795/ user=Everyone
# and a firewall rule for the port. Friends then open http://<your-ip>:8795/
#   add -Open to also open the game in your default browser (the "Play DZone.cmd" launcher does this)
param(
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8795 }),
  [switch]$Lan,
  [switch]$Open
)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$gameUrl = "http://localhost:$Port/"

# already running (e.g. a second double-click)? just open the game
try {
  $s = Invoke-WebRequest -Uri ($gameUrl + 'status') -UseBasicParsing -TimeoutSec 2
  if ($s.Content -like '*"relay":"dzone"*') {
    Write-Host "DZone server is already running on $gameUrl"
    if ($Open) { Start-Process $gameUrl }
    exit 0
  }
} catch { }

$code = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public class DzoneClient {
  public int Id;
  public WebSocket Ws;
  public HashSet<string> Subs = new HashSet<string>();
  public SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
  public volatile bool Alive = true;
}

public class DzoneRelay {
  string root;
  HttpListener listener;
  int nextId = 1;
  readonly object gate = new object();
  Dictionary<string, HashSet<DzoneClient>> channels = new Dictionary<string, HashSet<DzoneClient>>();
  List<DzoneClient> clients = new List<DzoneClient>();
  Dictionary<string, string> mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
    {".html","text/html; charset=utf-8"}, {".htm","text/html; charset=utf-8"}, {".css","text/css; charset=utf-8"},
    {".js","text/javascript; charset=utf-8"}, {".mjs","text/javascript; charset=utf-8"}, {".json","application/json"},
    {".png","image/png"}, {".jpg","image/jpeg"}, {".jpeg","image/jpeg"}, {".svg","image/svg+xml"}, {".gif","image/gif"},
    {".ico","image/x-icon"}, {".glb","model/gltf-binary"}, {".gltf","model/gltf+json"}, {".hdr","application/octet-stream"},
    {".mp3","audio/mpeg"}, {".ogg","audio/ogg"}, {".wav","audio/wav"}, {".woff","font/woff"}, {".woff2","font/woff2"}
  };

  public DzoneRelay(string rootDir) { root = rootDir; }

  public int ClientCount { get { lock (gate) { return clients.Count; } } }

  public void Start(string prefix) {
    listener = new HttpListener();
    listener.Prefixes.Add(prefix);
    listener.Start();
    Task.Run(() => AcceptLoop());
  }

  async Task AcceptLoop() {
    while (listener.IsListening) {
      HttpListenerContext ctx = null;
      try { ctx = await listener.GetContextAsync(); } catch { if (!listener.IsListening) return; continue; }
      HttpListenerContext c = ctx;
      Task handler = Task.Run(() => Handle(c));
    }
  }

  async Task Handle(HttpListenerContext ctx) {
    try {
      string path = ctx.Request.Url.AbsolutePath;
      if (ctx.Request.IsWebSocketRequest && path == "/ws") { await HandleSocket(ctx); return; }
      if (path == "/status") {
        WriteText(ctx.Response, "{\"relay\":\"dzone\",\"clients\":" + ClientCount + "}", "application/json");
        return;
      }
      if (path == "/") path = "/index.html";
      string rel = Uri.UnescapeDataString(path.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
      string full = Path.GetFullPath(Path.Combine(root, rel));
      if (!full.StartsWith(Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) {
        ctx.Response.StatusCode = 404;
        WriteText(ctx.Response, "Not found: " + path, "text/plain");
        return;
      }
      string ct;
      if (!mime.TryGetValue(Path.GetExtension(full), out ct)) ct = "application/octet-stream";
      byte[] bytes = File.ReadAllBytes(full);
      ctx.Response.ContentType = ct;
      ctx.Response.Headers["Cache-Control"] = "no-cache";
      ctx.Response.ContentLength64 = bytes.Length;
      if (ctx.Request.HttpMethod != "HEAD") await ctx.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
      ctx.Response.OutputStream.Close();
    } catch (Exception e) {
      try { Console.WriteLine("http error: " + e.Message); ctx.Response.Abort(); } catch { }
    }
  }

  void WriteText(HttpListenerResponse res, string text, string ct) {
    byte[] b = Encoding.UTF8.GetBytes(text);
    res.ContentType = ct;
    res.ContentLength64 = b.Length;
    res.OutputStream.Write(b, 0, b.Length);
    res.OutputStream.Close();
  }

  async Task HandleSocket(HttpListenerContext ctx) {
    HttpListenerWebSocketContext wctx = await ctx.AcceptWebSocketAsync(null);
    DzoneClient cl = new DzoneClient();
    cl.Ws = wctx.WebSocket;
    lock (gate) { cl.Id = nextId++; clients.Add(cl); }
    Console.WriteLine("+ client " + cl.Id + " (" + ClientCount + " online)");
    byte[] buf = new byte[65536];
    MemoryStream acc = new MemoryStream();
    try {
      while (cl.Ws.State == WebSocketState.Open) {
        WebSocketReceiveResult r = await cl.Ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
        if (r.MessageType == WebSocketMessageType.Close) break;
        acc.Write(buf, 0, r.Count);
        if (acc.Length > 4 * 1024 * 1024) break;
        if (!r.EndOfMessage) continue;
        string msg = Encoding.UTF8.GetString(acc.GetBuffer(), 0, (int)acc.Length);
        acc.SetLength(0);
        OnMessage(cl, msg);
      }
    } catch { }
    cl.Alive = false;
    lock (gate) {
      clients.Remove(cl);
      foreach (string ch in cl.Subs) { HashSet<DzoneClient> set; if (channels.TryGetValue(ch, out set)) { set.Remove(cl); if (set.Count == 0) channels.Remove(ch); } }
    }
    try { await cl.Ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
    Console.WriteLine("- client " + cl.Id + " (" + ClientCount + " online)");
  }

  // Protocol, one text frame per command:
  //   "S <channel>"            subscribe
  //   "U <channel>"            unsubscribe
  //   "P <channel>\n<payload>" publish to every other subscriber, delivered as "M <channel>\n<payload>"
  void OnMessage(DzoneClient cl, string msg) {
    if (msg.Length < 3) return;
    char cmd = msg[0];
    if (cmd == 'S' || cmd == 'U') {
      string ch = msg.Substring(2).Trim();
      lock (gate) {
        HashSet<DzoneClient> set;
        if (cmd == 'S') {
          if (!channels.TryGetValue(ch, out set)) { set = new HashSet<DzoneClient>(); channels[ch] = set; }
          set.Add(cl); cl.Subs.Add(ch);
        } else if (channels.TryGetValue(ch, out set)) {
          set.Remove(cl); cl.Subs.Remove(ch); if (set.Count == 0) channels.Remove(ch);
        }
      }
      return;
    }
    if (cmd == 'P') {
      int nl = msg.IndexOf('\n');
      if (nl < 0) return;
      string ch = msg.Substring(2, nl - 2).Trim();
      string outMsg = "M " + ch + msg.Substring(nl);
      List<DzoneClient> targets = new List<DzoneClient>();
      lock (gate) { HashSet<DzoneClient> set; if (channels.TryGetValue(ch, out set)) foreach (DzoneClient o in set) if (o != cl) targets.Add(o); }
      byte[] data = Encoding.UTF8.GetBytes(outMsg);
      foreach (DzoneClient t in targets) { DzoneClient tt = t; Task.Run(() => Send(tt, data)); }
    }
  }

  async Task Send(DzoneClient cl, byte[] data) {
    if (!cl.Alive) return;
    await cl.SendLock.WaitAsync();
    try {
      if (cl.Ws.State == WebSocketState.Open)
        await cl.Ws.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Text, true, CancellationToken.None);
    } catch { cl.Alive = false; }
    finally { cl.SendLock.Release(); }
  }
}
"@

Add-Type -TypeDefinition $code -Language CSharp

$relay = New-Object DzoneRelay($root)
$prefix = if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }
try {
  $relay.Start($prefix)
} catch {
  Write-Host "Could not bind $prefix : $($_.Exception.Message)"
  if ($Lan) { Write-Host "LAN mode needs admin, or run once as admin:  netsh http add urlacl url=http://+:$Port/ user=Everyone" }
  else { Write-Host "Is another program using port $Port? Try:  -Port 8796" }
  if ($Open) { Read-Host 'Press Enter to close' }
  exit 1
}
Write-Host "DZONE relay running on $prefix  (game: $gameUrl  websocket: /ws)"
Write-Host "Keep this window open while you play. Close it to stop the server."
if ($Open) { Start-Process $gameUrl }
if ($Lan) {
  $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' }
  foreach ($ip in $ips) { Write-Host "  friends on your network: http://$($ip):$Port/" }
}
while ($true) { Start-Sleep -Seconds 1 }
