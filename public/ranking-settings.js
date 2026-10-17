"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let audience = 'child', entries = [], saving = false, pendingId = null, editingId = null;
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
    $('add-result').disabled = saving;
    $('cancel-add').disabled = saving;
    $('cancel-edit').disabled = saving;
    for (const id of ['edit-result-name', 'edit-result-money', 'save-edited-result']) $(id).disabled = saving;
  }
  function render() {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.audience === audience)));
    const sorted = entries.filter(item => item.audience === audience).sort((a, b) => b.money - a.money);
    $('saved-ranking-count').textContent = `${sorted.length}人`;
    $('saved-ranking-empty').hidden = sorted.length > 0 || saving || Boolean($('ranking-load-message').textContent);
    $('saved-rankings').replaceChildren(...sorted.map(item => {
      const li = document.createElement('li');
      const rank = sorted.findIndex(other => other.money === item.money) + 1;
      li.className = `ranking-card settings-ranking-card${rank <= 3 ? ` ranking-place-${rank}` : ''}`;
      const position = document.createElement('span');
      position.className = 'ranking-position'; position.textContent = `${rank}位`;
      const identity = document.createElement('div');
      identity.className = 'ranking-identity';
      const name = document.createElement('strong');
      name.className = 'ranking-name'; name.textContent = item.name;
      const source = document.createElement('span');
      source.className = 'ranking-source'; source.textContent = item.source;
      identity.append(name, source);
      const money = document.createElement('strong');
      money.className = 'ranking-money'; money.textContent = `${item.money.toLocaleString('ja-JP')}円`;
      const actions = document.createElement('div');
      actions.className = 'settings-ranking-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'settings-small-button';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `${item.name}さんのランキング記録を削除`);
      remove.disabled = saving;
      remove.addEventListener('click', async () => {
        if (saving || !window.confirm(`${item.name}さんの記録（${item.money.toLocaleString('ja-JP')}円）をランキングから削除しますか？この操作は取り消せません。`)) return;
        saving = true; render();
        try {
          entries = await request({ id: item.id }, './api/admin/rankings/delete');
          message('ランキングから記録を削除しました。');
        } catch (error) { message(error.message); }
        finally { saving = false; render(); }
      });
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'settings-small-button'; edit.textContent = '編集';
      edit.setAttribute('aria-label', `${item.name}さんの名前と所持金を編集`);
      edit.disabled = saving || editingId !== null;
      edit.addEventListener('click', () => {
        if (saving || editingId !== null) return;
        editingId = item.id;
        $('edit-result-name').value = item.name; $('edit-result-money').value = String(item.money);
        $('ranking-editor-error').hidden = true;
        $('ranking-editor').showModal();
        render(); $('edit-result-name').focus();
      });
      remove.disabled = saving || editingId !== null;
      actions.append(remove, edit);
      li.append(position, identity, money, actions);
      return li;
    }));
    status();
  }
  async function request(input, path) {
    const response = await fetch(path || (input ? './api/rankings/paper' : './api/rankings'), {
      method: input ? 'POST' : 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ランキングに接続できませんでした。');
    return data.entries;
  }
  async function load() {
    if (saving) return;
    saving = true; render();
    try { entries = await request(); $('ranking-load-message').textContent = ''; render(); }
    catch (error) { $('ranking-load-message').textContent = error.message; }
    finally { saving = false; render(); }
  }
  buttons.forEach(button => button.addEventListener('click', () => { audience = button.dataset.audience; render(); }));
  fields.forEach(id => $(id).addEventListener('input', status));
  $('add-result').addEventListener('click', () => {
    if (saving) return;
    $('result-heading').textContent = `${audience === 'child' ? '子供' : '大人'}の結果を追加`;
    $('ranking-add-error').hidden = true;
    $('ranking-add').showModal(); $('result-name').focus();
  });
  $('cancel-add').addEventListener('click', () => { if (!saving) $('ranking-add').close(); });
  $('ranking-add').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('ranking-add').addEventListener('close', () => {
    pendingId = null; $('result-name').value = ''; $('result-money').value = '';
    status(); $('add-result').focus();
  });
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
      $('ranking-add').close();
      message('1人分の結果を保存しました。全員のランキングに反映されます。');
    } catch (error) { $('ranking-add-error').textContent = error.message; $('ranking-add-error').hidden = false; }
    finally { saving = false; render(); ($('ranking-add').open ? $('result-name') : $('add-result')).focus(); }
  });
  $('reload-rankings').addEventListener('click', load);
  $('cancel-edit').addEventListener('click', () => {
    if (saving) return;
    $('ranking-editor').close();
  });
  $('ranking-editor').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('ranking-editor').addEventListener('close', () => {
    editingId = null; render(); $('reload-rankings').focus();
  });
  $('ranking-editor-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || editingId === null) return;
    try {
      const name = $('edit-result-name').value.trim(), rawMoney = $('edit-result-money').value.trim();
      const money = Number(rawMoney);
      if (!name || name.length > 24 || !rawMoney || !Number.isSafeInteger(money)) throw new Error('表示名と所持金を確認してください。所持金は整数で入力してください。');
      saving = true; status();
      entries = await request({ id: editingId, name, money }, './api/admin/rankings/update');
      $('ranking-editor').close();
      message('名前と所持金を保存しました。全員のランキングに反映されます。');
    } catch (error) {
      $('ranking-editor-error').textContent = error.message; $('ranking-editor-error').hidden = false;
    } finally { saving = false; render(); }
  });
  window.addEventListener('beforeunload', event => { if (pending() || $('ranking-editor').open) { event.preventDefault(); event.returnValue = ''; } });
  render(); load();
})();
