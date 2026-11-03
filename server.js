const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const HTML = "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, user-scalable=no\">\n<title>경도 - 경찰과 도둑</title>\n<style>\n  *{box-sizing:border-box}\n  body{margin:0;background:#14181f;color:#eee;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh}\n  input,button{padding:10px 14px;border-radius:8px;border:0;font-size:16px}\n  button{background:#3b82f6;color:#fff;cursor:pointer}\n  button.g{background:#16a34a} button.x{background:#555}\n  #menu{width:100%;max-width:480px;padding:20px;display:flex;flex-direction:column;gap:14px}\n  h1{margin:0;text-align:center}\n  #status{text-align:center;font-size:14px;padding:6px;border-radius:8px;background:#7c2d12}\n  #status.ok{background:#14532d}\n  .row{display:flex;gap:6px} .row input{flex:1;min-width:0}\n  #rooms{display:flex;flex-direction:column;gap:6px}\n  .room{display:flex;justify-content:space-between;align-items:center;background:#1f2631;padding:10px 12px;border-radius:8px}\n  #game{display:none;width:100%;flex-direction:column;align-items:center}\n  #top{width:100%;max-width:900px;display:flex;justify-content:space-between;padding:8px 12px;font-weight:600}\n  canvas{width:100%;max-width:900px;aspect-ratio:8/5;background:#2b3a2b;border-radius:10px;touch-action:none}\n  #bar{display:flex;gap:8px;padding:10px;align-items:center}\n  #info{padding:4px 10px;color:#aaa;font-size:13px;text-align:center}\n</style>\n</head>\n<body>\n<div id=\"menu\">\n  <h1>🚓 경도 🏃</h1>\n  <div id=\"status\">서버 연결 중… (무료 서버는 처음에 30~60초 걸릴 수 있어요)</div>\n  <input id=\"name\" placeholder=\"닉네임\" maxlength=\"10\">\n  <div class=\"row\"><input id=\"room\" placeholder=\"새 방 이름\" maxlength=\"20\"><button id=\"create\" class=\"g\">방 만들기</button></div>\n  <div style=\"color:#aaa;font-size:14px\">열려 있는 방</div>\n  <div id=\"rooms\"><div style=\"color:#777\">방이 없어요. 직접 만들어보세요!</div></div>\n</div>\n<div id=\"game\">\n  <div id=\"top\"><span id=\"role\">-</span><span id=\"msg\">-</span><span id=\"time\">-</span></div>\n  <canvas id=\"c\" width=\"800\" height=\"500\"></canvas>\n  <div id=\"bar\"><span id=\"rname\"></span><button id=\"share\" class=\"x\">링크 복사</button><button id=\"start\" class=\"g\" style=\"display:none\">게임 시작</button><button id=\"leave\" class=\"x\">나가기</button></div>\n  <div id=\"info\">이동: 방향키 / WASD / 화면 드래그 · 경찰이 닿으면 체포 · 자유 도둑이 감옥에 닿으면 모두 구출</div>\n</div>\n<script>\nconst $ = id => document.getElementById(id);\nconst cv = $('c'), ctx = cv.getContext('2d');\nlet ws, myId, cfg, S = null, joined = false, roomName = '';\n\n$('name').value = localStorage.getItem('gd_name') || '';\nconst qRoom = new URLSearchParams(location.search).get('room');\nif (qRoom) $('room').value = qRoom;\n\nfunction setStatus(t, ok) { $('status').textContent = t; $('status').className = ok ? 'ok' : ''; }\nconst nick = () => { const n = $('name').value.trim() || '익명'; localStorage.setItem('gd_name', n); return n; };\nconst send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));\n\nfunction connect() {\n  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);\n  ws.onopen = () => {\n    setStatus('✅ 서버 연결됨', true);\n    if (qRoom && !joined) send({ t: 'join', name: nick(), room: qRoom }); // 링크로 들어오면 자동 입장 시도\n  };\n  ws.onerror = () => setStatus('서버 연결 오류… 다시 시도 중');\n  ws.onclose = () => {\n    if (joined) { $('msg').textContent = '연결 끊김 - 새로고침 해주세요'; return; }\n    setStatus('연결 끊김. 3초 후 재시도…'); setTimeout(connect, 3000);\n  };\n  ws.onmessage = e => {\n    const m = JSON.parse(e.data);\n    if (m.t === 'list') renderRooms(m.rooms);\n    else if (m.t === 'err') alert(m.msg);\n    else if (m.t === 'hi') {\n      myId = m.id; cfg = m; joined = true; roomName = m.room;\n      $('menu').style.display = 'none'; $('game').style.display = 'flex'; $('rname').textContent = '방: ' + m.room;\n      history.replaceState(null, '', '?room=' + encodeURIComponent(m.room));\n    } else if (m.t === 's') { S = m; hud(); }\n  };\n}\nconnect();\n\nfunction renderRooms(list) {\n  const box = $('rooms'); box.innerHTML = '';\n  if (!list.length) { box.innerHTML = '<div style=\"color:#777\">방이 없어요. 직접 만들어보세요!</div>'; return; }\n  list.forEach(r => {\n    const d = document.createElement('div'); d.className = 'room';\n    d.innerHTML = `<span>${r.name.replace(/</g, '&lt;')} · ${r.n}명 · ${r.st === 'play' ? '게임 중' : '대기 중'}</span>`;\n    const b = document.createElement('button'); b.textContent = '입장';\n    b.onclick = () => send({ t: 'join', name: nick(), room: r.name });\n    d.appendChild(b); box.appendChild(d);\n  });\n}\n\n$('create').onclick = () => {\n  const room = $('room').value.trim() || ('방' + Math.floor(1000 + Math.random() * 9000));\n  send({ t: 'create', name: nick(), room });\n};\n$('start').onclick = () => send({ t: 'start' });\n$('leave').onclick = () => { location.href = location.pathname; };\n$('share').onclick = () => {\n  navigator.clipboard.writeText(location.origin + '/?room=' + encodeURIComponent(roomName)).then(() => alert('링크를 복사했어요!'), () => prompt('링크', location.href));\n};\n\nfunction hud() {\n  const me = S.players.find(p => p.id === myId);\n  $('msg').textContent = S.st === 'play' && S.head > 0 ? `경찰 출발까지 ${S.head}초` : S.msg;\n  $('time').textContent = S.st === 'play' ? `⏱ ${S.left}s` : `${S.players.length}명`;\n  $('role').textContent = S.st === 'play' && me ? (me.r === 'police' ? '🚓 경찰' : me.j ? '⛓ 수감 중' : '🏃 도둑') : '대기';\n  $('start').style.display = S.host === myId && S.st === 'lobby' ? '' : 'none';\n}\n\nconst keys = {}; let touch = null, last = '';\naddEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (joined && e.key.startsWith('Arrow')) e.preventDefault(); });\naddEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });\ncv.addEventListener('touchstart', e => { const t = e.touches[0]; touch = { x0: t.clientX, y0: t.clientY, x: 0, y: 0 }; });\ncv.addEventListener('touchmove', e => {\n  const t = e.touches[0]; if (!touch) return;\n  const dx = t.clientX - touch.x0, dy = t.clientY - touch.y0, d = Math.hypot(dx, dy);\n  touch.x = d > 12 ? dx / d : 0; touch.y = d > 12 ? dy / d : 0;\n});\ncv.addEventListener('touchend', () => { touch = null; });\n\nsetInterval(() => {\n  if (!joined) return;\n  let x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);\n  let y = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);\n  if (touch) { x = touch.x; y = touch.y; }\n  const s = x.toFixed(2) + ',' + y.toFixed(2);\n  if (s !== last) { last = s; send({ t: 'in', x, y }); }\n}, 50);\n\nfunction draw() {\n  requestAnimationFrame(draw);\n  if (!cfg) return;\n  ctx.clearRect(0, 0, 800, 500);\n  const j = cfg.jail; ctx.fillStyle = '#6b7280'; ctx.fillRect(j.x, j.y, j.w, j.h);\n  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText('감옥', j.x + 38, j.y + 14);\n  ctx.fillStyle = '#4b3b2a'; cfg.walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));\n  if (!S) return;\n  for (const p of S.players) {\n    ctx.beginPath(); ctx.arc(p.x, p.y, cfg.R, 0, 7);\n    ctx.fillStyle = S.st === 'lobby' ? '#a3a3a3' : p.j ? '#9ca3af' : p.r === 'police' ? '#3b82f6' : '#ef4444';\n    ctx.fill();\n    if (p.id === myId) { ctx.lineWidth = 3; ctx.strokeStyle = '#facc15'; ctx.stroke(); }\n    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';\n    ctx.fillText(p.n, p.x, p.y - 16); ctx.textAlign = 'left';\n  }\n}\ndraw();\n</script>\n</body>\n</html>\n";
const app = express();
app.get('/health', (_, res) => res.send('ok'));
app.get('/', (req, res) => res.type('html').send(HTML));
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

function sendList(ws) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'list', rooms: [...rooms.values()].map(r => ({ name: r.name, n: r.players.size, st: r.st })) }));
}

wss.on('connection', ws => {
  let me = null, room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  sendList(ws);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const err = msg => ws.send(JSON.stringify({ t: 'err', msg }));
    if (m.t === 'list') return sendList(ws);
    if ((m.t === 'join' || m.t === 'create') && !me) {
      const rn = String(m.room || '').trim().slice(0, 20);
      if (!rn) return err('방 이름을 입력하세요');
      if (m.t === 'create' && rooms.has(rn)) return err('이미 있는 방 이름이에요');
      if (m.t === 'join' && !rooms.has(rn)) return err('없는 방이에요 (방이 사라졌을 수 있어요)');
      room = getRoom(rn);
      if (room.players.size >= 12) return err('방이 가득 찼어요 (최대 12명)');
      me = { id: nextId++, ws, name: String(m.name || '익명').slice(0, 10), role: 'thief', x: 400, y: 250, ix: 0, iy: 0, jailed: false };
      room.players.set(me.id, me);
      if (!room.host) room.host = me.id;
      ws.joined = true;
      ws.send(JSON.stringify({ t: 'hi', room: room.name, id: me.id, W, H, jail: JAIL, walls: WALLS, R }));
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

setInterval(() => { wss.clients.forEach(c => { if (!c.joined) sendList(c); }); }, 2000);
setInterval(() => {
  wss.clients.forEach(c => { if (!c.isAlive) return c.terminate(); c.isAlive = false; c.ping(); });
}, 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('경도 서버 실행:', PORT));
