const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('ランキング設定：1人ずつ保存、区分切替、失敗後の再試行', async () => {
  function element() {
    return { value: '', textContent: '', hidden: false, disabled: false, children: [], handlers: {}, dataset: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setAttribute() {}, append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      get lastElementChild() { return this.children.at(-1); },
      querySelector() { return this.children[0].children[0]; }, focus() {},
      click() { return this.handlers.click?.(); },
    };
  }
  const elements = new Map(), audiences = ['child', 'adult'].map(audience => Object.assign(element(), { dataset: { audience } }));
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const calls = [];
  let fail = true, id = 0;
  const context = vm.createContext({
    document: { getElementById: $, querySelectorAll: () => audiences, createElement: element },
    window: { addEventListener() {} }, crypto: { randomUUID: () => `id-${++id}` }, AbortSignal,
    fetch: async (path, options) => {
      if (!options.body) return { ok: true, json: async () => ({ entries: [] }) };
      const input = JSON.parse(options.body); calls.push(input);
      return { ok: !fail, json: async () => fail ? { error: '通信に失敗しました。' } : { entries: input.entries } };
    },
  });
  vm.runInContext(fs.readFileSync('public/ranking-settings.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  function fill(name, money) {
    $('result-name').value = name; $('result-money').value = money;
    $('result-name').handlers.input();
  }
  $('result-source').value = 'グループ';
  fill('子供の参加者', '120000');
  const save = () => $('ranking-settings-form').handlers.submit({ preventDefault() {} });
  await save();
  assert.equal(calls[0].entries.length, 1);
  assert.equal(calls[0].entries[0].money, 120000);
  assert.equal(calls[0].entries[0].source, 'グループ');
  assert.equal(calls[0].entries[0].audience, 'child');
  assert.match($('ranking-settings-message').textContent, /通信に失敗/);
  assert.equal($('result-name').value, '子供の参加者');
  assert.equal($('result-money').value, '120000');
  assert.equal($('save-results').disabled, false);
  fail = false; await save();
  assert.equal(calls[1].entries[0].name, calls[0].entries[0].name);
  assert.equal($('result-name').value, '');
  assert.equal($('result-money').value, '');
  assert.equal($('save-results').disabled, true);
  assert.equal($('saved-rankings').children.length, 1);
  assert.match($('saved-rankings').children[0].textContent, /グループ/);
  await audiences[1].click(); fill('大人の参加者', '-500');
  $('result-source').value = 'ひとり'; await save();
  assert.equal(calls[2].entries.length, 1);
  assert.equal(calls[2].entries[0].audience, 'adult');
  assert.equal(calls[2].entries[0].money, -500);
  fill('不正な所持金', '1.5'); await save();
  assert.equal(calls.length, 3);
  assert.equal($('result-money').value, '1.5');
});
