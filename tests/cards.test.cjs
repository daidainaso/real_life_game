const test = require('node:test');
const assert = require('node:assert/strict');
const { audienceGame } = require('../public/cards.js');
const game = require('../public/script.js');

test('対象の山札は最後まで固定される', () => {
  for (const id of ['child', 'adult']) {
    const { config, cards } = audienceGame(id);
    let state = game.create(config, cards);
    for (let i = 0; i < 100 && state.status === 'playing'; i++) {
      state = game.draw(state, cards, config).state;
      assert.equal(state.era, id);
      assert.equal(game.validState(state, config, cards), true);
    }
  }
  assert.throws(() => audienceGame('unknown'));
  assert.ok(audienceGame('child').cards.every(c => c.id.startsWith('child-')));
});
