const test = require('node:test');
const assert = require('node:assert/strict');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

test('Workers実行環境：共有山札、WebSocket同期、権限、重複操作、再接続、永続状態', async t => {
  const bundle = await build({ entryPoints: ['worker.mjs'], bundle: true, format: 'esm', write: false, platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'game', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-11', durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true } } }));
  t.after(() => mf.dispose());
  async function api(path, input, token) {
    const response = await mf.dispatchFetch('http://localhost/api/rooms' + path, {
      method: input ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, ...await response.json() };
  }
  async function connect(code, token) {
    const response = await mf.dispatchFetch(`http://localhost/api/rooms/${code}/socket?token=${token}`, { headers: { Upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket, queue = [], waiters = [];
    ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (waiters.length) waiters.shift()(data); else queue.push(data); });
    ws.accept();
    return { ws, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket応答がありません')), 5000);
      waiters.push(data => { clearTimeout(timer); resolve(data); });
    }) };
  }
  const host = await api('', { name: 'ホスト', audience: 'child' });
  assert.equal(host.status, 201); assert.match(host.room.code, /^\d{6}$/);
  const route = '/' + host.room.code;
  const a = await connect(host.room.code, host.token); await a.next();
  const guest = await api(route + '/join', { name: '参加者' });
  assert.equal(guest.status, 201); assert.equal((await a.next()).room.players.length, 2);
  const b = await connect(host.room.code, guest.token); let state = (await b.next()).room;
  const other = await api('', { name: '別の部屋', audience: 'adult' });
  assert.equal((await api(route, null, other.token)).status, 403);
  assert.equal((await api(route)).status, 403);
  b.ws.send(JSON.stringify({ type: 'start', revision: state.revision }));
  assert.equal((await b.next()).type, 'error'); await b.next(); await a.next();
  a.ws.send(JSON.stringify({ type: 'start', revision: state.revision }));
  state = (await a.next()).room; assert.equal(state.status, 'playing'); await b.next();
  assert.equal((await api(route + '/join', { name: '遅刻' })).status, 409);
  await mf.unsafeEvictDurableObject('game', 'GameRoom', { name: host.room.code, webSockets: 'hibernate' });
  b.ws.send(JSON.stringify({ type: 'draw', revision: state.revision, yourIndex: 0 }));
  assert.equal((await b.next()).type, 'error'); await b.next(); await a.next();
  const ids = new Set(), balances = [100000, 100000], positions = [0, 0];
  for (let index = 0; index < 13; index++) {
    const current = state.turn, connection = current === 0 ? a : b;
    const request = JSON.stringify({ type: 'draw', revision: state.revision });
    connection.ws.send(request);
    const eventA = await a.next(), eventB = await b.next();
    const sa = eventA.room, sb = eventB.room;
    assert.equal(sa.revision, sb.revision); assert.deepEqual(sa.last, sb.last);
    assert.equal(sa.turn, 1 - current);
    if (index % 6 === 0) ids.clear();
    assert.ok(!ids.has(sa.last.card.id)); ids.add(sa.last.card.id);
    balances[current] += sa.last.card.money;
    positions[current] = Math.max(0, Math.min(sa.goal, positions[current] + sa.last.card.move));
    assert.deepEqual(sa.players.map(p => p.money), balances);
    assert.deepEqual(sa.players.map(p => p.position), positions);
    assert.ok(!JSON.stringify(sa).includes(host.token));
    state = sa;
    if (index === 0) {
      connection.ws.send(request);
      assert.equal((await a.next()).type, 'error'); await a.next(); await b.next();
      assert.equal((await api(route, null, host.token)).room.revision, state.revision);
    }
  }
  for (let count = 0; count < 1000 && state.status === 'playing'; count++) {
    const current = state.turn, wasGoal = state.players[current].position >= state.goal;
    const connection = current === 0 ? a : b;
    connection.ws.send(JSON.stringify({ type: 'draw', revision: state.revision }));
    const eventA = await a.next(), eventB = await b.next();
    const sa = eventA.room, sb = eventB.room;
    if (sa.status === 'finished') {
      assert.equal(eventA.type, 'state'); assert.equal(eventB.type, 'state');
    }
    assert.equal(sa.status, sb.status); assert.deepEqual(sa.players, sb.players);
    assert.equal(sa.last.bonus, wasGoal);
    if (wasGoal) { assert.ok(sa.last.card.money > 0); assert.equal(sa.last.card.move, 0); assert.equal(sa.players[current].position, 50); }
    state = sa;
  }
  assert.equal(state.status, 'finished'); assert.ok(state.players.every(p => p.position === 50));
  (state.turn === 0 ? a : b).ws.send(JSON.stringify({ type: 'draw', revision: state.revision }));
  const errorSocket = state.turn === 0 ? a : b;
  assert.equal((await errorSocket.next()).type, 'error');
  await a.next(); await b.next();
  assert.deepEqual((await api(route, null, host.token)).room, state);
  a.ws.close(); b.ws.close();
  const resumed = await connect(host.room.code, host.token);
  assert.deepEqual((await resumed.next()).room, state); resumed.ws.close();
  assert.equal((await api('/' + other.room.code, null, other.token)).room.status, 'waiting');
  await mf.unsafeEvictDurableObject('game', 'GameRoom', { name: host.room.code });
  assert.deepEqual((await api(route, null, host.token)).room, state);
});
