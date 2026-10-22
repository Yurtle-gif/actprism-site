// Cloudflare Worker + Durable Object: online co-op rooms for Flock Kitty.
// GET /room/ABCD (WebSocket upgrade) joins room ABCD. The first socket with ?role=host owns the room;
// up to three more players join it. The room never runs the game: the host's browser does, and this
// object only relays messages, so it stays tiny and cheap.
//
// Wire format (all text frames):
//   host -> room:   "*" + payload      broadcast to every player
//                   "<id>:" + payload  to one player
//   player -> room: payload            delivered to the host as "<id>:" + payload
//   room -> anyone: JSON control frames {t: 'welcome' | 'join' | 'leave' | 'error' | 'end', ...}
//
// Uses the hibernation WebSocket API, so an idle room costs nothing and the per-socket player info
// lives in socket attachments rather than in memory.

const MAX_PLAYERS = 4;
const MAX_FRAME = 64 * 1024;
const CODE = /^\/room\/([A-Z0-9]{4,8})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(CODE);
    if (!m) return new Response('Flock Kitty rooms', { headers: { 'content-type': 'text/plain' } });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    // ALLOWED_ORIGINS (comma separated) keeps other sites from using this relay; unset allows any origin
    const allow = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    if (allow.length && !allow.some(a => origin === a || (a.startsWith('*.') && origin.endsWith(a.slice(1))))) return new Response('origin not allowed', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  }
};

export class Room {
  constructor(state) { this.state = state; }

  players() { return this.state.getWebSockets().map(ws => ({ ws, a: ws.deserializeAttachment() || {} })); }
  host() { return this.players().find(p => p.a.host); }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'join';
    const clean = (k, n) => (url.searchParams.get(k) || '').replace(/[^\w .'-]/g, '').slice(0, n);
    const info = { name: clean('name', 16) || 'Player', cat: clean('cat', 12), fit: clean('fit', 12) };
    const [client, server] = Object.values(new WebSocketPair());
    const list = this.players(), host = list.find(p => p.a.host);
    let err = '';
    if (role === 'host' && host) err = 'That room code is taken. Try again.';
    else if (role === 'join' && !host) err = 'No room with that code.';
    else if (list.length >= MAX_PLAYERS) err = 'That room is full.';
    if (err) {
      server.accept();
      server.send(JSON.stringify({ t: 'error', msg: err }));
      server.close(4000, 'refused');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = role === 'host' ? 0 : Math.max(0, ...list.map(p => p.a.id)) + 1;
    server.serializeAttachment({ id, host: role === 'host', ...info });
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'welcome', id }));
    if (host) host.ws.send(JSON.stringify({ t: 'join', id, ...info }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_FRAME) return;
    const a = ws.deserializeAttachment() || {};
    if (!a.host) {
      const h = this.host();
      if (h) try { h.ws.send(a.id + ':' + msg); } catch (e) {}
      return;
    }
    if (msg[0] === '*') {
      const out = msg.slice(1);
      for (const p of this.players()) if (!p.a.host) try { p.ws.send(out); } catch (e) {}
      return;
    }
    const c = msg.indexOf(':');
    const to = +msg.slice(0, c);
    for (const p of this.players()) if (!p.a.host && p.a.id === to) try { p.ws.send(msg.slice(c + 1)); } catch (e) {}
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = ws.deserializeAttachment() || {};
    try { ws.close(1000, 'bye'); } catch (e) {}
    if (a.host) {
      // the game lived in the host's browser, so the room ends with them
      for (const p of this.players()) if (p.ws !== ws) { try { p.ws.send(JSON.stringify({ t: 'end' })); p.ws.close(1000, 'host left'); } catch (e) {} }
      return;
    }
    const h = this.host();
    if (h) try { h.ws.send(JSON.stringify({ t: 'leave', id: a.id })); } catch (e) {}
  }
}
