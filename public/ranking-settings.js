"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let audience = 'child', drafts = [], entries = [], saving = false;
  const buttons = document.querySelectorAll('[data-audience]');
  function message(text) { $('ranking-settings-message').textContent = text; $('ranking-settings-message').hidden = false; }
  function status() {
    $('ranking-save-status').textContent = saving ? '保存しています…' : drafts.length ? `未保存の結果が${drafts.length}人分あります` : '未保存の結果はありません';
    $('save-results').disabled = saving || !drafts.length;
    for (const id of ['add-result', 'add-result-bottom']) $(id).disabled = saving || drafts.length >= 100;
  }
  function render() {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audience === audience)));
    const current = drafts.filter(item => item.audience === audience);
    $('ranking-draft-count').textContent = `${current.length}人`;
    $('ranking-drafts').replaceChildren(...current.map(item => {
      const row = document.createElement('tr');
      for (const [key, label, type] of [['name', '参加者の表示名', 'text'], ['money', '最終所持金（円）', 'number']]) {
        const cell = document.createElement('td'), input = document.createElement('input');
        input.type = type; input.value = item[key]; input.required = true; input.disabled = saving;
        input.setAttribute('aria-label', label);
        if (type === 'number') input.step = '1'; else input.maxLength = 24;
        input.addEventListener('input', () => { item[key] = input.value; status(); });
        cell.append(input); row.append(cell);
      }
      const modeCell = document.createElement('td'), mode = document.createElement('select');
      mode.setAttribute('aria-label', '参加形式'); mode.disabled = saving;
      for (const source of ['ひとり', 'グループ']) {
        const option = document.createElement('option'); option.value = source; option.textContent = source; mode.append(option);
      }
      mode.value = item.source;
      mode.addEventListener('change', () => { item.source = mode.value; status(); });
      modeCell.append(mode); row.append(modeCell);
      const cell = document.createElement('td'), remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '削除'; remove.disabled = saving;
      remove.setAttribute('aria-label', `${item.name || '未入力の参加者'}の未保存の結果を削除`);
      remove.addEventListener('click', () => { drafts = drafts.filter(other => other !== item); render(); });
      cell.append(remove); row.append(cell); return row;
    }));
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
  for (const id of ['add-result', 'add-result-bottom']) $(id).addEventListener('click', () => {
    if (saving || drafts.length >= 100) return;
    drafts.push({ id: crypto.randomUUID(), audience, name: '', money: '', source: 'ひとり' }); render();
    $('ranking-drafts').lastElementChild.querySelector('input').focus();
  });
  $('ranking-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !drafts.length) return;
    try {
      const results = drafts.map(item => {
        const money = Number(item.money);
        if (!item.name.trim() || item.name.trim().length > 24 || !item.money.trim() || !Number.isSafeInteger(money)) throw new Error('両方の区分の表示名と所持金を確認してください。所持金は整数で入力してください。');
        return { ...item, name: item.name.trim(), money };
      });
      saving = true; render();
      entries = await request({ entries: results });
      drafts = []; message('結果を保存しました。全員のランキングに反映されています。');
    } catch (error) { message(error.message); }
    finally { saving = false; render(); }
  });
  $('reload-rankings').addEventListener('click', load);
  window.addEventListener('beforeunload', event => { if (drafts.length) { event.preventDefault(); event.returnValue = ''; } });
  render(); load();
})();
