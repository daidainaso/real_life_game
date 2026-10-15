const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = require('../public/script.js');

test('グループ画面：モード選択、参加、手番表示、連打防止、再接続、画面を閉じる', async () => {
  const elements = new Map(), timers = new Map(), sockets = [];
  function element() {
    const handlers = {}, classes = new Set();
    return { hidden: false, disabled: false, value: '', textContent: '',
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      addEventListener: (name, callback) => { (handlers[name] ||= []).push(callback); },
      click: async () => { for (const callback of handlers.click || []) await callback(); }, replaceChildren(...items) { this.children = items; },
      focus() {}, showModal() {},
      setAttribute(name, value) { (this.attributes ||= {})[name] = value; },
    };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let state = { code: '001234', audience: 'child', status: 'waiting', revision: 1, host: true, yourIndex: 0, turn: 0, last: null, goal: 50,
    players: [{ name: 'ホスト', money: 100000, position: 0 }, { name: '参加者', money: 100000, position: 0 }] };
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen(); }
    update(room) { this.onmessage({ data: JSON.stringify({ type: 'state', room }) }); }
  }
  $('audience').value = 'child'; $('player-name').value = 'ホスト';
  const document = { getElementById: $, createElement: element, body: element() };
  const requests = [];
  const context = vm.createContext({ document, LifeGame: game, audiences: { child: { label: '子供' } }, WebSocket: Socket,
    URL, location: { href: 'https://example.com/', protocol: 'https:' }, AbortSignal,
    localStorage: { getItem: key => key === 'lifeGame.cardSettings.v1' ? JSON.stringify({ child: [{ id: 'custom-child', title: '設定済みカード', money: 1234, move: 5, icon: '✦' }], adult: [{ id: 'custom-adult', title: '大人の設定', money: 5678, move: 2, icon: '✦' }] }) : null, setItem() {} },
    setTimeout: (fn, delay) => { const id = timers.size + 1; fn.delay = delay; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { requests.push({ url, input: options.body ? JSON.parse(options.body) : null }); return { ok: true, json: async () => ({ token: 'secret', room: state }) }; },
  });
  vm.runInContext(fs.readFileSync('public/cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/card-settings-store.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/script.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/rooms.js', 'utf8'), context);
  await $('start').click(); assert.equal($('play').hidden, false);
  assert.equal($('event-ranking').hidden, true);
  await $('home').click(); assert.equal($('welcome').hidden, false); assert.equal($('play').hidden, true);
  $('group-mode').click(); assert.equal($('welcome').hidden, true); assert.equal($('room-entry').hidden, false);
  assert.equal($('room-audience-child').attributes['aria-pressed'], 'true');
  await $('room-audience-adult').click();
  assert.equal($('room-audience').value, 'adult');
  assert.equal($('room-audience-adult').attributes['aria-pressed'], 'true');
  await $('room-audience-child').click();
  await $('create-room').click();
  assert.equal(requests[0].input.cards[0].id, 'custom-child');
  assert.equal(requests[0].input.cards[0].money, 1234);
  assert.equal(requests[0].input.bonusCards.length, 4);
  assert.equal(requests[0].input.bonusCards[0].move, 0);
  const ws = sockets[0]; assert.match(ws.url.href, /^wss:/);
  assert.equal($('room-start').disabled, true);
  ws.open(); ws.update(state); assert.equal($('room-start').disabled, false);
  $('room-start').click(); $('room-start').click(); assert.equal(ws.sent.length, 1);
  state = { ...state, status: 'playing', revision: 2 }; ws.update(state);
  assert.equal($('event-ranking').hidden, true);
  assert.equal($('room-status').textContent, 'あなたの番です'); assert.equal($('room-draw').disabled, false);
  $('room-draw').click(); $('room-draw').click(); assert.equal(ws.sent.length, 2);
  state = { ...state, revision: 3, turn: 1, last: { name: 'ホスト', card: { title: '旅行', money: -1000, move: -2 } } };
  ws.update(state); assert.equal($('room-draw').disabled, true);
  assert.match($('room-scores').children[0].textContent, /現在 0 \/ 50マス/);
  ws.update({ ...state, players: [{ ...state.players[0], position: 8 }, state.players[1]] });
  assert.match($('room-scores').children[0].textContent, /現在 8 \/ 50マス/);
  assert.equal($('room-status').textContent, '参加者さんの番です');
  assert.equal($('room-card').textContent, 'ホストさん：旅行'); assert.equal($('room-move').textContent, '2マス戻る');
  ws.close(); assert.equal($('room-draw').disabled, true);
  const reconnect = [...timers.values()].find(fn => fn.delay === 2500); reconnect();
  const next = sockets[1]; next.open(); next.update({ ...state, turn: 0 });
  assert.equal($('room-draw').disabled, false);
  next.update({ ...state, turn: 0, players: [{ ...state.players[0], position: 50 }, state.players[1]] });
  assert.match($('room-draw').textContent, /ボーナスカード/);
  assert.match($('room-scores').children[0].textContent, /ゴール済み/);
  assert.equal($('room-finish').hidden, false);
  context.window = { confirm: () => false };
  await $('room-finish').click();
  assert.equal(next.sent.length, 0);
  context.window.confirm = () => true;
  await $('room-finish').click();
  assert.equal(next.sent[0].type, 'finish');
  next.update({ ...state, status: 'finished', players: state.players.map(p => ({ ...p, position: 50 })) });
  assert.match($('room-status').textContent, /ゲーム終了/);
  assert.equal($('room-draw').hidden, true);
  assert.equal($('room-again').hidden, false);
  assert.equal($('room-play').hidden, true);
  assert.equal($('room-result').hidden, false);
  assert.equal($('event-ranking').hidden, false);
  assert.equal($('room-result-money').textContent, '100,000円');
  assert.equal($('room-result-scores').children.length, 2);
  await $('room-again').click(); assert.equal($('room-play').hidden, true); assert.equal($('room-entry').hidden, true);
  assert.equal($('welcome').hidden, false);
  assert.equal($('room-result').hidden, true);
  assert.equal($('event-ranking').hidden, false);
  assert.equal(next.readyState, 3);
});

test('全接続の結果表示：終了通知の受信・取りこぼし・スマートフォン復帰', async () => {
  const clients = [];
  for (const yourIndex of [0, 1, 0, 1]) {
    const elements = new Map();
    const element = () => ({ hidden: true, value: '', textContent: '', handlers: {},
      setAttribute(name, value) { (this.attributes ||= {})[name] = value; },
      classList: { add() {}, remove() {}, toggle() {} }, focus() {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      click() { return this.handlers.click?.(); }, replaceChildren(...children) { this.children = children; } });
    const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const initial = { code: '123456', audience: 'child', host: yourIndex === 0, yourIndex, turn: 1, goal: 50,
      status: 'playing', revision: 10, last: null,
      players: [{ name: '先着者', money: 110000, position: 50 }, { name: '最後の到達者', money: 120000, position: 49 }] };
    let socket, serverState = initial, timerId = 0;
    const timers = new Map(), listeners = {};
    class Socket {
      static OPEN = 1;
      constructor() { socket = this; this.readyState = 1; }
      close() {} send() {}
    }
    const context = vm.createContext({ document: { getElementById: $, createElement: element, body: element(),
      visibilityState: 'visible', addEventListener: (name, fn) => { listeners[name] = fn; } },
      LifeGame: game, audiences: { child: { label: '子供' } }, WebSocket: Socket, URL, AbortSignal,
      location: { href: 'https://example.com/', protocol: 'https:' },
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
      fetch: async () => ({ ok: true, json: async () => ({ token: 'token', room: serverState }) }) });
    vm.runInContext(fs.readFileSync('public/rooms.js', 'utf8'), context);
    await $('create-room').click();
    assert.equal($('room-play').hidden, false);
    assert.equal($('room-result').hidden, true);
    clients.push({ $, socket, initial, timers, listeners, setState: value => { serverState = value; } });
  }
  for (const [index, { $, socket, initial, timers, listeners, setState }] of clients.entries()) {
    const finished = { ...initial, status: 'finished', revision: 11, players: initial.players.map(p => ({ ...p, position: 50 })) };
    setState(finished);
    if (index < 2) socket.onmessage({ data: JSON.stringify({ type: 'state', room: finished }) });
    else if (index === 2) await [...timers.values()][0]();
    else { listeners.visibilitychange(); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal($('room-play').hidden, true);
    assert.equal($('room-result').hidden, false);
    assert.equal($('room-result-money').textContent, game.amount(initial.players[initial.yourIndex].money));
    assert.equal($('room-result-scores').children.length, 2);
    assert.equal(timers.size, 0);
  }
});
