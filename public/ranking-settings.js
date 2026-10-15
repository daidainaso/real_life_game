"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let audience = 'child', entries = [], saving = false, pendingId = null;
  const buttons = document.querySelectorAll('[data-audience]');
  const fields = ['result-name', 'result-money', 'result-source'];
  const pending = () => Boolean($('result-name').value || $('result-money').value);
  function message(text) { $('ranking-settings-message').textContent = text; $('ranking-settings-message').hidden = false; }
  function status() {
    $('ranking-save-status').textContent = saving ? '保存しています…' : pending() ? '入力中の結果があります' : '次の参加者の結果を入力してください';
    $('save-results').disabled = saving || !pending();
    fields.forEach(id => { $(id).disabled = saving; });
    buttons.forEach(button => { button.disabled = saving; });
    $('reload-rankings').disabled = saving;
  }
  function render() {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audience === audience)));
    const sorted = entries.filter(item => item.audience === audience).sort((a, b) => b.money - a.money);
    $('saved-rankings').replaceChildren(...sorted.map(item => {
      const li = document.createElement('li');
      li.textContent = `${sorted.findIndex(other => other.money === item.money) + 1}位 · ${item.name}：${item.money.toLocaleString('ja-JP')}円（${item.source}）`;
      return li;
    }));
    status();
  }
  async function request(input) {
    const response = await fetch(input ? './api/rankings/paper' : './api/rankings', {
      method: input ? 'POST' : 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ランキングに接続できませんでした。');
    return data.entries;
  }
  async function load() {
    try { entries = await request(); $('ranking-load-message').textContent = ''; render(); }
    catch (error) { $('ranking-load-message').textContent = error.message; }
  }
  buttons.forEach(button => button.addEventListener('click', () => { audience = button.dataset.audience; render(); }));
  fields.forEach(id => $(id).addEventListener('input', status));
  $('ranking-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !pending()) return;
    try {
      const name = $('result-name').value.trim(), rawMoney = $('result-money').value.trim();
      const money = Number(rawMoney);
      if (!name || name.length > 24 || !rawMoney || !Number.isSafeInteger(money)) throw new Error('表示名と所持金を確認してください。所持金は整数で入力してください。');
      pendingId ??= crypto.randomUUID();
      const results = [{ id: pendingId, audience, name, money, source: $('result-source').value }];
      saving = true; render();
      entries = await request({ entries: results });
      pendingId = null;
      $('result-name').value = ''; $('result-money').value = '';
      message('1人分の結果を保存しました。次の参加者を入力できます。');
    } catch (error) { message(error.message); }
    finally { saving = false; render(); $('result-name').focus(); }
  });
  $('reload-rankings').addEventListener('click', load);
  window.addEventListener('beforeunload', event => { if (pending()) { event.preventDefault(); event.returnValue = ''; } });
  render(); load();
})();
