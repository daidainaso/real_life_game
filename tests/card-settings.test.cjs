const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const game = require('../public/script.js');
function setup() {
  const context = vm.createContext({ module: { exports: {} } });
  for (const name of ['cards.js', 'card-settings-store.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), context);
  const records = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  return { settings: context.module.exports, storage };
}
test('編集設定を保存して抽選に反映し、開始済みの山札を維持する', () => {
  const { settings, storage } = setup();
  const value = settings.defaults();
  value.child = [{ id: 'custom-event', title: '設定した出来事', money: 1234, move: 5, icon: '✦' }];
  settings.save(storage, value);
  const started = settings.game('child', storage);
  const state = game.create(started.config, started.cards);
  assert.equal(game.draw(state, started.cards, started.config).state.money, 101234);
  value.child = [{ id: 'new-event', title: '変更後の出来事', money: 0, move: 2, icon: '✦' }];
  settings.save(storage, value);
  assert.equal(settings.game('child', storage).cards[0].id, 'new-event');
  assert.equal(game.validState(state, started.config, started.cards), true);
  assert.equal(game.draw(state, started.cards, started.config).card.id, 'custom-event');
  assert.equal(settings.game('adult', storage).cards.length, settings.defaults().adult.length);
});
test('不正な設定とゴールできない山札を拒否し、保存済み設定を保護する', () => {
  const { settings, storage } = setup();
  const value = settings.defaults();
  settings.save(storage, value);
  const raw = storage.getItem(settings.key);
  for (const mutate of [v => { v.child = []; }, v => { v.child[0].money = 0.5; }, v => { v.child[0].move = 51; }, v => { v.child[0].title = ' '; }, v => { v.child.push({ ...v.child[0] }); }, v => { v.child.forEach(card => { card.move = 0; }); }]) {
    const broken = JSON.parse(JSON.stringify(value)); mutate(broken);
    assert.throws(() => settings.save(storage, broken));
    assert.equal(storage.getItem(settings.key), raw);
  }
  assert.throws(() => settings.save({ setItem() { throw new Error('storage denied'); } }, value), /storage denied/);
});

test('旧設定の互換性を保ち、ボーナス設定を保存・JSON移行できる', () => {
  const { settings, storage } = setup();
  const value = settings.defaults();
  delete value.bonus;
  storage.setItem(settings.key, JSON.stringify(value));
  const upgraded = settings.load(storage);
  assert.equal(upgraded.bonus.child.length, 4);
  upgraded.bonus.child = [{ id: 'custom-bonus', title: '特別なお祝い', money: 7654, move: 0, icon: '🎁' }];
  settings.save(storage, upgraded);
  assert.equal(settings.load(storage).bonus.child[0].money, 7654);
  const imported = settings.validate(JSON.parse(JSON.stringify(settings.load(storage))));
  assert.equal(imported.bonus.child[0].title, '特別なお祝い');
  assert.throws(() => settings.validateCards([{ ...imported.bonus.child[0], move: 1 }], true));
  assert.throws(() => settings.validateCards([], true));
  assert.throws(() => settings.validate({ ...upgraded, bonus: null }));
});

test('部屋作成時のボーナス設定を共有・保持し、ゴール後の抽選に反映する', async () => {
  const { GameRoom } = await import('../worker.mjs');
  for (const audience of ['child', 'adult']) {
    let saved;
    const messages = [], pending = [];
    const socket = { deserializeAttachment: () => ({ token: saved.players[0].token }), send: raw => messages.push(JSON.parse(raw)) };
    const ctx = { storage: { get: async () => saved && structuredClone(saved), put: async (key, value) => { saved = structuredClone(value); } }, blockConcurrencyWhile: fn => { const promise = fn(); pending.push(promise); return promise; }, getWebSockets: () => [socket] };
    let room = new GameRoom(ctx); await Promise.all(pending);
    const bonusCards = [{ id: 'custom-bonus', title: '編集したボーナス', money: 7654, move: 0, icon: '🎁' }];
    const request = input => new Request('http://localhost/api/rooms/123456/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal((await room.fetch(request({ name: 'ホスト', audience, bonusCards: [{ ...bonusCards[0], move: 1 }] }))).status, 400);
    assert.equal((await room.fetch(request({ name: 'ホスト', audience, bonusCards }))).status, 201);
    assert.equal(saved.bonusCards[0].title, '編集したボーナス');
    bonusCards[0].money = 9999;
    room.room.players.push({ id: 'guest', token: 'guest-token', name: '参加者', money: 100000, position: 40 });
    room.room.players[0].position = 50;
    await room.webSocketMessage(socket, JSON.stringify({ type: 'start', revision: room.room.revision }));
    room = new GameRoom(ctx); await Promise.all(pending);
    await room.webSocketMessage(socket, JSON.stringify({ type: 'draw', revision: saved.revision }));
    assert.equal(saved.last.card.money, 7654);
    assert.equal(saved.last.bonus, true);
    assert.equal(saved.players[0].money, 107654);
    assert.equal(saved.players[0].position, 50);
    assert.equal(messages.at(-1).room.last.card.title, '編集したボーナス');
  }
});
