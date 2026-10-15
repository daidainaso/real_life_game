const test = require('node:test');
const assert = require('node:assert/strict');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

test('共通ランキング：公開閲覧、暗証番号なしの紙登録、重複防止、区分、永続化、途中終了の権限と同期', async t => {
  const bundle = await build({ entryPoints: ['./worker.mjs'], bundle: true, format: 'esm', write: false, platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'ranking-test', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-11', durableObjects: { ROOMS: { className: 'GameRoom', useSQLite: true } } }));
  t.after(() => mf.dispose());
  async function api(path, input, token) {
    const response = await mf.dispatchFetch(`http://localhost/api/${path}`, { method: input ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: input ? JSON.stringify(input) : undefined });
    return { status: response.status, ...await response.json() };
  }
  assert.deepEqual((await api('rankings')).entries, []);
  const paper = { id: 'paper-test', name: '紙の参加者', money: -500, audience: 'child' };
  assert.equal((await api('rankings/paper', { ...paper, money: 1.5 })).status, 400);
  assert.equal((await api('rankings/paper', paper)).status, 200);
  await api('rankings/paper', paper);
  await api('rankings', { id: 'solo-test', name: '個人', money: 120000, audience: 'adult' });
  let entries = (await api('rankings')).entries;
  assert.equal(entries.length, 2); assert.equal(entries[0].money, 120000);
  await mf.unsafeEvictDurableObject('ranking-test', 'GameRoom', { name: 'event-rankings' });
  assert.deepEqual((await api('rankings')).entries, entries);
  const host = await api('rooms', { name: 'ホスト', audience: 'child' });
  const route = `rooms/${host.room.code}`;
  const guest = await api(`${route}/join`, { name: '参加者' });
  assert.equal((await api(`${route}/ranking`, {}, host.token)).status, 409);
  async function connect(token) {
    const response = await mf.dispatchFetch(`http://localhost/api/${route}/socket?token=${token}`, { headers: { Upgrade: 'websocket' } });
    const ws = response.webSocket, queue = [], waiting = [];
    ws.addEventListener('message', event => { const value = JSON.parse(event.data); waiting.length ? waiting.shift()(value) : queue.push(value); });
    ws.accept();
    return { ws, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve)) };
  }
  const a = await connect(host.token), b = await connect(guest.token);
  let state = (await a.next()).room; await b.next();
  a.ws.send(JSON.stringify({ type: 'start', revision: state.revision }));
  state = (await a.next()).room; await b.next();
  b.ws.send(JSON.stringify({ type: 'finish', revision: state.revision }));
  assert.equal((await b.next()).type, 'error'); await b.next(); await a.next();
  a.ws.send(JSON.stringify({ type: 'finish', revision: state.revision }));
  assert.equal((await a.next()).room.status, 'finished');
  assert.equal((await b.next()).room.status, 'finished');
  assert.equal((await api(`${route}/ranking`, {})).status, 403);
  entries = (await api(`${route}/ranking`, {}, guest.token)).entries;
  assert.equal(entries.length, 4);
  assert.equal((await api(`${route}/ranking`, {}, host.token)).entries.length, 4);
  const batch = { entries: [
    { id: 'batch-child', name: '子供の参加者', money: 300, audience: 'child', source: 'グループ' },
    { id: 'batch-adult', name: '大人の参加者', money: 400, audience: 'adult', source: 'ひとり' },
  ] };
  assert.equal((await api('rankings/paper', { ...batch, entries: [batch.entries[0], { ...batch.entries[1], money: 0.5 }] })).status, 400);
  assert.equal((await api('rankings')).entries.length, 4);
  assert.equal((await api('rankings/paper', batch)).entries.length, 6);
  const saved = (await api('rankings')).entries;
  assert.equal(saved.find(p => p.id === 'paper-batch-child').source, 'グループ');
  assert.equal(saved.find(p => p.id === 'paper-batch-adult').source, 'ひとり');
  assert.equal((await api('rankings/paper', { ...paper, source: 'その他' })).status, 400);
  assert.equal((await api('rankings/paper', batch)).entries.length, 6);
  a.ws.close(); b.ws.close();
});
