const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(__dirname + '/public'));
app.get('/health', (_, res) => res.send('ok'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- 게임 설정 ----
const W = 800, H = 500, R = 11, TICK = 30, GAME_SEC = 120, HEAD = 3;
const SPEED = { police: 170, thief: 175 };
const JAIL = { x: 20, y: 20, w: 110, h: 90 };
const WALLS = [
  { x: 250, y: 120, w: 30, h: 200 }, { x: 420, y: 260, w: 200, h: 30 },
  { x: 520, y: 60, w: 30, h: 130 },  { x: 300, y: 400, w: 180, h: 30 },
  { x: 130, y: 250, w: 90, h: 30 },
];

const rooms = new Map();
let nextId = 1;

function getRoom(name) {
  if (!rooms.has(name))
    rooms.set(name, { name, players: new Map(), st: 'lobby', left: 0, head: 0, msg: '대기 중', host: null, endAt: 0 });
  return rooms.get(name);
}
function hitWall(x, y) {
  for (const w of WALLS) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    if ((x - cx) ** 2 + (y - cy) ** 2 < R * R) return true;
  }
  return false;
}
function spawn(role) {
  for (;;) {
    const x = role === 'police' ? 680 + Math.random() * 90 : 160 + Math.random() * 80;
    const y = role === 'police' ? 40 + Math.random() * 420 : 300 + Math.random() * 160;
    if (!hitWall(x, y)) return { x, y };
  }
}
function startGame(room) {
  const list = [...room.players.values()].sort(() => Math.random() - 0.5);
  const nPolice = Math.max(1, Math.round(list.length / 3));
  list.forEach((p, i) => {
    p.role = i < nPolice ? 'police' : 'thief';
    p.jailed = false;
    Object.assign(p, spawn(p.role));
  });
  room.st = 'play';
  room.left = GAME_SEC;
  room.head = HEAD;
  room.msg = '경찰은 잠시 후 출발! 도둑은 도망가세요';
}
function endGame(room, msg) {
  room.st = 'end';
  room.msg = msg;
  room.endAt = Date.now() + 5000;
}

function step(room, dt) {
  if (room.st === 'end') {
    if (Date.now() > room.endAt) { room.st = 'lobby'; room.msg = '대기 중 (방장이 시작)'; }
    return;
  }
  if (room.st !== 'play') return;
  room.left -= dt;
  if (room.head > 0) { room.head -= dt; if (room.head <= 0) room.msg = '추격 시작!'; }

  for (const p of room.players.values()) {
    if (p.role === 'police' && room.head > 0) continue;
    const sp = (p.jailed ? 90 : SPEED[p.role]) * dt;
    const len = Math.hypot(p.ix, p.iy) || 1;
    const mx = (p.ix / len) * sp, my = (p.iy / len) * sp;
    if (!p.ix && !p.iy) continue;
    let nx = p.x + mx, ny = p.y + my;
    if (p.jailed) {
      nx = Math.max(JAIL.x + R, Math.min(JAIL.x + JAIL.w - R, nx));
      ny = Math.max(JAIL.y + R, Math.min(JAIL.y + JAIL.h - R, ny));
      p.x = nx; p.y = ny; continue;
    }
    nx = Math.max(R, Math.min(W - R, nx));
    ny = Math.max(R, Math.min(H - R, ny));
    if (!hitWall(nx, p.y)) p.x = nx;
    if (!hitWall(p.x, ny)) p.y = ny;
  }

  const ps = [...room.players.values()];
  const police = ps.filter(p => p.role === 'police');
  const thieves = ps.filter(p => p.role === 'thief');

  // 잡기
  if (room.head <= 0) {
    for (const t of thieves) {
      if (t.jailed) continue;
      for (const c of police) {
        if (Math.hypot(t.x - c.x, t.y - c.y) < R * 2 + 2) {
          t.jailed = true;
          t.x = JAIL.x + 20 + Math.random() * (JAIL.w - 40);
          t.y = JAIL.y + 20 + Math.random() * (JAIL.h - 40);
          room.msg = `${t.name} 체포!`;
          break;
        }
      }
    }
  }
  // 구출: 자유 도둑이 감옥에 닿으면 모두 석방
  const free = thieves.filter(t => !t.jailed);
  const rescuer = free.find(t => t.x > JAIL.x - R && t.x < JAIL.x + JAIL.w + R && t.y > JAIL.y - R && t.y < JAIL.y + JAIL.h + R);
  if (rescuer && thieves.some(t => t.jailed)) {
    thieves.forEach(t => { if (t.jailed) { t.jailed = false; t.x = JAIL.x + JAIL.w + 25; t.y = JAIL.y + JAIL.h + 25; } });
    room.msg = `${rescuer.name} 님이 모두를 구출!`;
  }

  if (thieves.length && thieves.every(t => t.jailed)) endGame(room, '🚓 경찰 승리!');
  else if (room.left <= 0) endGame(room, '🏃 도둑 승리!');
}

function broadcast(room) {
  const msg = JSON.stringify({
    t: 's', st: room.st, left: Math.max(0, Math.ceil(room.left)), head: Math.ceil(Math.max(0, room.head)),
    msg: room.msg, host: room.host,
    players: [...room.players.values()].map(p => ({
      id: p.id, n: p.name, r: p.role, x: Math.round(p.x), y: Math.round(p.y), j: p.jailed,
    })),
  });
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}

wss.on('connection', ws => {
  let me = null, room = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      const rn = String(m.room || 'main').slice(0, 20);
      room = getRoom(rn);
      if (room.players.size >= 12) return ws.send(JSON.stringify({ t: 'err', msg: '방이 가득 찼어요 (최대 12명)' }));
      me = { id: nextId++, ws, name: String(m.name || '익명').slice(0, 10), role: 'thief', x: 400, y: 250, ix: 0, iy: 0, jailed: false };
      room.players.set(me.id, me);
      if (!room.host) room.host = me.id;
      ws.send(JSON.stringify({ t: 'hi', id: me.id, W, H, jail: JAIL, walls: WALLS, R }));
    } else if (m.t === 'in' && me) {
      me.ix = Math.max(-1, Math.min(1, +m.x || 0));
      me.iy = Math.max(-1, Math.min(1, +m.y || 0));
    } else if (m.t === 'start' && me && room.host === me.id && room.st === 'lobby') {
      if (room.players.size < 2) { room.msg = '최소 2명이 필요해요'; return; }
      startGame(room);
    }
  });
  ws.on('close', () => {
    if (!me) return;
    room.players.delete(me.id);
    if (room.host === me.id) room.host = room.players.keys().next().value || null;
    if (room.players.size === 0) rooms.delete(room.name);
  });
});

setInterval(() => {
  for (const room of rooms.values()) { step(room, 1 / TICK); broadcast(room); }
}, 1000 / TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('경도 서버 실행:', PORT));
