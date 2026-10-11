const test = require('node:test');
const assert = require('node:assert/strict');
const { bonusCards } = require('../public/cards.js');

test('全員ゴールで終了し、先着者は別の山札でボーナスを引く（両対象・一巡・復元）', async () => {
  const { GameRoom } = await import('../worker.mjs');
  for (const audience of ['child', 'adult']) {
    const players = [
      { id: 'a', token: 'a-token', name: '先着者', money: 100000, position: 50 },
      { id: 'b', token: 'b-token', name: '参加者', money: 100000, position: 40 },
    ];
    let saved = { code: '123456', audience, players, goal: 50, started: true, finished: false, turn: 0, revision: 0, last: null,
      cards: [{ id: 'step', title: '一歩進む', money: -100, move: 1 }], deck: ['step'], deckIndex: 0,
      bonusCards: bonusCards[audience], bonusDeck: bonusCards[audience].map(c => c.id), bonusDeckIndex: 0 };
    const messages = [];
    const socket = { deserializeAttachment: () => ({ token: saved.players[saved.turn].token }), send: data => messages.push(JSON.parse(data)) };
    const pending = [];
    const ctx = { storage: { get: async () => structuredClone(saved), put: async (key, value) => { saved = structuredClone(value); } },
      blockConcurrencyWhile: fn => { const promise = fn(); pending.push(promise); return promise; }, getWebSockets: () => [socket] };
    let room = new GameRoom(ctx); await Promise.all(pending);
    const seen = new Set();
    for (let round = 0; round < 10; round++) {
      const previousDeck = [...saved.deck], previousIndex = saved.deckIndex, previousMoney = saved.players[0].money;
      await room.webSocketMessage(socket, JSON.stringify({ type: 'draw', revision: saved.revision, bonus: false }));
      assert.equal(saved.last.bonus, true);
      assert.equal(saved.players[0].position, 50);
      assert.equal(saved.players[0].money, previousMoney + saved.last.card.money);
      assert.equal(saved.last.card.move, 0);
      const range = audience === 'child' ? [500, 2000] : [5000, 20000];
      assert.ok(saved.last.card.money >= range[0] && saved.last.card.money <= range[1]);
      assert.deepEqual(saved.deck, previousDeck); assert.equal(saved.deckIndex, previousIndex);
      if (round % 4 === 0) seen.clear();
      assert.ok(!seen.has(saved.last.card.id)); seen.add(saved.last.card.id);
      assert.equal(saved.turn, 1);
      await room.webSocketMessage(socket, JSON.stringify({ type: 'draw', revision: saved.revision, bonus: true }));
      assert.equal(saved.last.bonus, false);
      assert.equal(saved.players[1].position, 41 + round);
      assert.equal(saved.finished, round === 9);
      if (round === 4) { room = new GameRoom(ctx); await Promise.all(pending); }
    }
    assert.equal(room.view(room.room.players[0]).status, 'finished');
    assert.ok(room.view(room.room.players[0]).players.every(p => p.finished));
    const end = structuredClone(saved);
    await room.webSocketMessage(socket, JSON.stringify({ type: 'draw', revision: saved.revision }));
    assert.deepEqual(saved, end);
    assert.ok(messages.some(m => m.type === 'error' && m.error.includes('終了')));
    room = new GameRoom(ctx); await Promise.all(pending);
    assert.equal(room.view(room.room.players[0]).status, 'finished');
  }
});
