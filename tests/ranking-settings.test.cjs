const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('ランキング設定：区分切替、表入力、削除、一括保存、失敗後の再試行', async () => {
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
    const row = $('ranking-drafts').children[0];
    for (const [index, value] of [name, money].entries()) {
      const input = row.children[index].children[0]; input.value = value; input.handlers.input();
    }
  }
  await $('add-result').click(); fill('子供の参加者', '120000');
  const mode = $('ranking-drafts').children[0].children[2].children[0];
  mode.value = 'グループ'; mode.handlers.change();
  await audiences[1].click(); await $('add-result-bottom').click(); fill('大人の参加者', '-500');
  await audiences[0].click();
  assert.equal($('ranking-drafts').children[0].children[0].children[0].value, '子供の参加者');
  const save = () => $('ranking-settings-form').handlers.submit({ preventDefault() {} });
  await save();
  assert.equal(calls[0].entries.length, 2);
  assert.equal(calls[0].entries[1].money, -500);
  assert.equal(calls[0].entries[0].source, 'グループ');
  assert.equal(calls[0].entries[1].source, 'ひとり');
  assert.match($('ranking-settings-message').textContent, /通信に失敗/);
  assert.equal(Object.hasOwn(calls[0], 'pin'), false);
  assert.equal($('ranking-drafts').children.length, 1);
  fail = false; await save();
  assert.deepEqual(calls[0].entries, calls[1].entries);
  assert.equal($('ranking-drafts').children.length, 0);
  assert.equal($('saved-rankings').children.length, 1);
  assert.match($('saved-rankings').children[0].textContent, /（グループ）/);
  assert.equal($('save-results').disabled, true);
  await $('add-result').click();
  await $('ranking-drafts').children[0].children[3].children[0].click();
  assert.equal($('ranking-drafts').children.length, 0);
});
