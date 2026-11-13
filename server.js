"use strict";
// Velvet North Network — original, dependency-free multiplayer server.
// Uses only Node.js built-ins; no hosted game backend or WebSocket package required.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const PORT = Number(process.env.PORT || 8787);
const MAX_ROOMS = 30, MAX_PLAYERS = 12, MAX_MESSAGE = 512 * 1024;
const rooms = new Map();
const OPEN = 1, CLOSING = 2, CLOSED = 3;

class Peer extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.readyState = OPEN; this.didFinish = false; this.buffer = Buffer.alloc(0);
    this.fragment = []; this.fragmentBytes = 0; this.isAlive = true; this.messageCount = 0; this.rateWindow = Date.now();
    socket.on("data", chunk => this.consume(chunk));
    socket.on("error", err => this.emit("error", err));
    socket.on("close", () => this.finish());
  }
  frame(opcode, payload = Buffer.alloc(0)) {
    if ((this.readyState !== OPEN && this.readyState !== CLOSING) || this.socket.destroyed) return;
    payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (payload.length < 126) { header = Buffer.from([0x80 | opcode, payload.length]); }
    else if (payload.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    this.socket.write(Buffer.concat([header, payload]));
  }
  send(value) { this.frame(1, Buffer.from(String(value))); }
  ping() { this.frame(9); }
  close(code = 1000, reason = "") {
    if (this.readyState !== OPEN) return; this.readyState = CLOSING;
    const msg = Buffer.from(String(reason).slice(0, 100)); const body = Buffer.alloc(2 + msg.length); body.writeUInt16BE(code, 0); msg.copy(body, 2);
    this.frame(8, body); this.socket.end(); setTimeout(() => this.socket.destroy(), 1500).unref();
  }
  terminate() { this.socket.destroy(); this.finish(); }
  finish() { if (this.didFinish) return; this.didFinish = true; this.readyState = CLOSED; this.emit("close"); }
  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const a = this.buffer[0], b = this.buffer[1], fin = !!(a & 0x80), opcode = a & 15, masked = !!(b & 0x80);
      if ((a & 0x70) !== 0 || !masked) return this.close(1002, "invalid frame");
      let len = b & 127, offset = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; const n = this.buffer.readBigUInt64BE(2); if (n > BigInt(MAX_MESSAGE)) return this.close(1009, "message too large"); len = Number(n); offset = 10; }
      if (len > MAX_MESSAGE) return this.close(1009, "message too large");
      if (this.buffer.length < offset + 4 + len) return;
      const mask = this.buffer.subarray(offset, offset + 4); offset += 4;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + len)); this.buffer = this.buffer.subarray(offset + len);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (opcode === 8) { this.close(1000, "bye"); return; }
      if (opcode === 9) { this.frame(10, payload); continue; }
      if (opcode === 10) { this.isAlive = true; this.emit("pong"); continue; }
      if (opcode === 1 || opcode === 2) {
        if (this.fragment.length) return this.close(1002, "unexpected data frame");
        if (fin) { if (opcode !== 1) return this.close(1003, "text only"); this.emit("message", payload); }
        else { this.fragment = [payload]; this.fragmentBytes = payload.length; }
      } else if (opcode === 0) {
        if (!this.fragment.length) return this.close(1002, "unexpected continuation");
        this.fragment.push(payload); this.fragmentBytes += payload.length;
        if (this.fragmentBytes > MAX_MESSAGE) return this.close(1009, "message too large");
        if (fin) { this.emit("message", Buffer.concat(this.fragment)); this.fragment = []; this.fragmentBytes = 0; }
      } else return this.close(1002, "unsupported opcode");
    }
  }
}

const peers = new Set();
const server = http.createServer((req, res) => {
  const requestPath = new URL(req.url, "http://localhost").pathname;
  if (requestPath === "/health" || requestPath === "/healthz") return json(res, 200, { ok: true, service: "Velvet North Network", version: 1, rooms: rooms.size, maxRooms: MAX_ROOMS, uptime: Math.floor(process.uptime()) });
  if (requestPath === "/api/rooms") {
    const list = [...rooms.values()].filter(r => !r.private && r.host.readyState === OPEN).map(r => ({ id: r.id, roomCode: r.code, name: r.name, players: r.clients.size + 1, maxPlayers: MAX_PLAYERS, private: false }));
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("cache-control", "no-store");
    return json(res, 200, { rooms: list, capacity: MAX_ROOMS });
  }
  // Serve the game itself from this same process so one launch starts both
  // the blackjack website and its multiplayer endpoint.
  const webRoot = path.resolve(__dirname, "..");
  const requested = path.resolve(webRoot, "." + decodeURIComponent(requestPath === "/" ? "/index.html" : requestPath));
  if (requested !== webRoot && !requested.startsWith(webRoot + path.sep)) return json(res, 403, { error: "forbidden" });
  fs.stat(requested, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: "not-found" });
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon" };
    res.writeHead(200, { "content-type": types[path.extname(requested).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(requested).pipe(res);
  });
});
function json(res, status, value) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (new URL(req.url, "http://localhost").pathname !== "/ws" || req.headers.upgrade?.toLowerCase() !== "websocket" || !key) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  const peer = new Peer(socket); peers.add(peer); peer.on("close", () => peers.delete(peer)); peer.on("error", () => peer.terminate()); attachGameProtocol(peer);
});

const send = (peer, obj) => { if (peer && peer.readyState === OPEN) peer.send(JSON.stringify(obj)); };
const makeCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();
const hash = (s, salt = "") => crypto.scryptSync(String(s), salt, 32).toString("hex");
const safeEqual = (a, b) => { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); };
function roomByCode(value) { const normalized = String(value || "").toUpperCase(); return [...rooms.values()].find(r => r.code === normalized); }
function removeRoom(room, reason = "host-left") { if (!room) return; rooms.delete(room.id); for (const peer of room.clients.values()) { send(peer, { type: "error", message: "The table host disconnected. The room has closed." }); peer.close(1001, reason); } room.clients.clear(); }
function leave(peer) { const room = peer.room; if (!room) return; peer.room = null; if (peer.isHost) { removeRoom(room); return; } if (room.clients.has(peer.playerId)) { room.clients.delete(peer.playerId); send(room.host, { type: "peer-left", peerId: peer.playerId }); } }
function fail(peer, message) { send(peer, { type: "error", message }); }
function attachGameProtocol(peer) {
  peer.on("pong", () => { peer.isAlive = true; });
  peer.on("message", raw => {
    const now = Date.now(); if (now - peer.rateWindow > 10000) { peer.rateWindow = now; peer.messageCount = 0; }
    if (++peer.messageCount > 160) return fail(peer, "Too many messages. Please slow down.");
    let m; try { m = JSON.parse(raw.toString("utf8")); } catch { return fail(peer, "Invalid message format."); }
    if (!m || typeof m.type !== "string") return;
    if (m.type === "ping") { if (peer.room) peer.room.lastActivity = now; send(peer, { type: "pong", at: now }); return; }
    if (m.type === "host") {
      if (peer.room) return fail(peer, "This connection already belongs to a room.");
      if (rooms.size >= MAX_ROOMS) return fail(peer, "All 30 server slots are currently in use. Try again later.");
      const code = String(m.roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (code.length < 2) return fail(peer, "Room code must contain at least 2 letters or numbers.");
      if (roomByCode(code)) return fail(peer, "That room code is already in use. Choose another.");
      const isPrivate = !!m.private, password = String(m.password || "");
      if (isPrivate && password.length < 4) return fail(peer, "Private rooms need a password of at least 4 characters.");
      const salt = isPrivate ? crypto.randomBytes(16).toString("hex") : null;
      const room = { id: crypto.randomUUID(), code, name: String(m.name || "Velvet North Table").slice(0, 24), private: isPrivate, passwordSalt: salt, passwordHash: isPrivate ? hash(password, salt) : null, host: peer, hostId: "host-" + crypto.randomBytes(5).toString("hex"), clients: new Map(), createdAt: now, lastActivity: now };
      rooms.set(room.id, room); peer.room = room; peer.isHost = true;
      send(peer, { type: "registered", roomId: room.id, roomCode: room.code, hostId: room.hostId, private: isPrivate }); return;
    }
    if (m.type === "join") {
      if (peer.room) return fail(peer, "This connection already belongs to a room.");
      const room = m.roomId ? rooms.get(String(m.roomId)) : roomByCode(m.roomCode);
      if (!room || room.host.readyState !== OPEN) return fail(peer, "That table could not be found. Refresh the directory or check the code.");
      if (room.clients.size + 1 >= MAX_PLAYERS) return fail(peer, "This table is full (12 players maximum).");
      if (room.private && !safeEqual(hash(String(m.password || ""), room.passwordSalt), room.passwordHash)) return fail(peer, "That private-room password is incorrect.");
      const playerId = "p-" + crypto.randomBytes(7).toString("hex"); peer.room = room; peer.playerId = playerId; room.clients.set(playerId, peer); room.lastActivity = now;
      send(peer, { type: "joined", roomId: room.id, roomCode: room.code, playerId, state: null });
      send(room.host, { type: "peer-message", peerId: playerId, payload: { type: "hello", name: String(m.name || "Guest").slice(0, 18), look: m.look || {} } }); return;
    }
    if (m.type === "to-peer" && peer.isHost && peer.room) { const target = peer.room.clients.get(String(m.peerId)); if (target) send(target, { type: "peer-data", payload: m.payload }); peer.room.lastActivity = now; return; }
    if (m.type === "disconnect-peer" && peer.isHost && peer.room) { const id = String(m.peerId); const target = peer.room.clients.get(id); if (target) { peer.room.clients.delete(id); target.close(1000, "removed by host"); send(peer, { type: "peer-left", peerId: id }); } return; }
    if (m.type === "action" && peer.room && !peer.isHost) { send(peer.room.host, { type: "peer-message", peerId: peer.playerId, payload: { type: "action", action: String(m.action || ""), data: m.data || {} } }); peer.room.lastActivity = now; return; }
    if (m.type === "host-state" && peer.isHost && peer.room) { for (const client of peer.room.clients.values()) send(client, { type: "state", state: m.state }); return; }
  });
  peer.on("close", () => leave(peer));
}

const heartbeat = setInterval(() => { for (const peer of peers) { if (peer.isAlive === false) { peer.terminate(); continue; } peer.isAlive = false; peer.ping(); } }, 25000);
const maintenance = setInterval(() => { const now = Date.now(); for (const room of rooms.values()) if (room.host.readyState !== OPEN || now - room.lastActivity > 36 * 60 * 60 * 1000) removeRoom(room, "maintenance"); }, 24 * 60 * 60 * 1000);
heartbeat.unref(); maintenance.unref();
server.listen(PORT, "0.0.0.0", () => console.log(`Velvet North Network listening on port ${PORT}`));
function shutdown() { clearInterval(heartbeat); clearInterval(maintenance); for (const room of [...rooms.values()]) { send(room.host, { type: "error", message: "The multiplayer service is restarting. Please reconnect shortly." }); room.host.close(1001, "server-shutdown"); removeRoom(room, "server-shutdown"); } server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
