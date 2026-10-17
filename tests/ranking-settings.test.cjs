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
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close?.(); },
    };
  }
  const elements = new Map(), audiences = ['child', 'adult'].map(audience => Object.assign(element(), { dataset: { audience } }));
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const calls = [];
  let fail = true, id = 0, confirmDelete = false, deleteCalls = 0;
  const context = vm.createContext({
    document: { getElementById: $, querySelectorAll: () => audiences, createElement: element },
    window: { addEventListener() {}, confirm: () => confirmDelete }, crypto: { randomUUID: () => `id-${++id}` }, AbortSignal,
    fetch: async (path, options) => {
      if (!options.body) return { ok: true, json: async () => ({ entries: [] }) };
      if (path === './api/admin/rankings/update') {
        const input = JSON.parse(options.body);
        assert.equal(input.id, 'id-1');
        return { ok: !fail, json: async () => fail ? { error: '変更に失敗しました。' } : { entries: [{ ...input, audience: 'child', source: 'グループ' }] } };
      }
      if (path === './api/admin/rankings/delete') {
        deleteCalls++;
        assert.equal(JSON.parse(options.body).id, 'id-1');
        return { ok: !fail, json: async () => fail ? { error: '削除に失敗しました。' } : { entries: [] } };
      }
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
  await $('add-result').click();
  assert.equal($('ranking-add').open, true);
  assert.match($('result-heading').textContent, /子供/);
  $('result-source').value = 'グループ';
  fill('子供の参加者', '120000');
  const save = () => $('ranking-settings-form').handlers.submit({ preventDefault() {} });
  await save();
  assert.equal(calls[0].entries.length, 1);
  assert.equal(calls[0].entries[0].money, 120000);
  assert.equal(calls[0].entries[0].source, 'グループ');
  assert.equal(calls[0].entries[0].audience, 'child');
  assert.match($('ranking-add-error').textContent, /通信に失敗/);
  assert.equal($('ranking-add').open, true);
  assert.equal($('result-name').value, '子供の参加者');
  assert.equal($('result-money').value, '120000');
  assert.equal($('save-results').disabled, false);
  fail = false; await save();
  assert.equal($('ranking-add').open, false);
  assert.equal(calls[1].entries[0].name, calls[0].entries[0].name);
  assert.equal($('result-name').value, '');
  assert.equal($('result-money').value, '');
  assert.equal($('save-results').disabled, true);
  assert.equal($('saved-rankings').children.length, 1);
  assert.equal($('saved-rankings').children[0].children[0].textContent, '1位');
  assert.equal($('saved-rankings').children[0].children[1].children[1].textContent, 'グループ');
  assert.equal($('saved-ranking-count').textContent, '1人');
  await $('saved-rankings').children[0].lastElementChild.children[1].click();
  assert.equal($('ranking-editor').open, true);
  assert.equal($('edit-result-name').value, '子供の参加者');
  const editSave = () => $('ranking-editor-form').handlers.submit({ preventDefault() {} });
  $('edit-result-name').value = '変更した名前'; $('edit-result-money').value = '-250';
  fail = true; await editSave();
  assert.match($('ranking-editor-error').textContent, /変更に失敗/);
  assert.equal($('edit-result-name').value, '変更した名前');
  assert.equal($('ranking-editor').open, true);
  fail = false; await editSave();
  assert.equal($('ranking-editor').open, false);
  assert.equal($('saved-rankings').children[0].children[1].children[0].textContent, '変更した名前');
  assert.equal($('saved-rankings').children[0].children[2].textContent, '-250円');
  assert.equal($('result-name').value, '');
  await $('add-result').click();
  fill('登録途中の名前', '500');
  await $('cancel-add').click();
  assert.equal($('ranking-add').open, false);
  assert.equal($('result-name').value, '');
  assert.equal($('result-money').value, '');
  await $('saved-rankings').children[0].lastElementChild.children[1].click();
  $('edit-result-name').value = 'キャンセルする名前';
  await $('cancel-edit').click();
  assert.equal($('result-name').value, '');
  assert.equal($('result-money').value, '');
  assert.equal($('ranking-editor').open, false);
  fill('', '');
  assert.equal($('saved-rankings').children[0].children[1].children[0].textContent, '変更した名前');
  await $('saved-rankings').children[0].lastElementChild.children[0].click();
  assert.equal(deleteCalls, 0);
  confirmDelete = true; fail = true;
  await $('saved-rankings').children[0].lastElementChild.children[0].click();
  assert.equal($('saved-rankings').children.length, 1);
  assert.match($('ranking-settings-message').textContent, /削除に失敗/);
  fail = false;
  await $('saved-rankings').children[0].lastElementChild.children[0].click();
  assert.equal(deleteCalls, 2);
  assert.equal($('saved-rankings').children.length, 0);
  await audiences[1].click();
  await $('add-result').click();
  assert.match($('result-heading').textContent, /大人/);
  fill('大人の参加者', '-500');
  $('result-source').value = 'ひとり'; await save();
  assert.equal(calls[2].entries.length, 1);
  assert.equal(calls[2].entries[0].audience, 'adult');
  assert.equal(calls[2].entries[0].money, -500);
  await $('add-result').click();
  fill('不正な所持金', '1.5'); await save();
  assert.equal(calls.length, 3);
  assert.equal($('result-money').value, '1.5');
});
