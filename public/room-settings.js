"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let groups = [], busy = false;
  async function request(path, input) {
    const response = await fetch(`./api/admin/groups${path}`, {
      method: input ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'グループの状態を取得できませんでした。');
    return data;
  }
  function render() {
    $('reload-groups').disabled = busy;
    $('managed-groups').replaceChildren(...groups.map(group => {
      const card = document.createElement('section');
      card.className = 'admin-menu-item managed-group';
      const heading = document.createElement('h2');
      heading.textContent = `グループ ${group.group}`;
      const detail = document.createElement('p');
      const labels = { empty: '未作成', finished: '未作成', waiting: '参加受付中', playing: 'プレイ中', unknown: '状態を確認できません' };
      detail.textContent = labels[group.status];
      if (['waiting', 'playing'].includes(group.status)) detail.textContent += ` · ${group.count}/12人 · ${group.audience === 'child' ? '子供' : '大人'}`;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'primary';
      button.textContent = 'このグループを終了する';
      button.disabled = busy || !['waiting', 'playing'].includes(group.status);
      button.addEventListener('click', () => finish(group));
      card.append(heading, detail, button);
      return card;
    }));
  }
  async function load() {
    if (busy) return;
    busy = true; render();
    try { groups = (await request('')).groups; $('group-management-message').textContent = ''; }
    catch (error) { groups = []; $('group-management-message').textContent = error.message; }
    finally { busy = false; render(); }
  }
  async function finish(group) {
    if (busy || !window.confirm(`グループ ${group.group} を終了しますか？現在の所持金で結果を確定します。`)) return;
    busy = true; render();
    try {
      await request(`/${group.group}/finish`, { code: group.code });
      groups = groups.map(item => item.group === group.group ? { ...item, status: 'finished' } : item);
      $('group-management-message').textContent = `グループ ${group.group} を終了しました。`;
    } catch (error) { $('group-management-message').textContent = `${error.message}「最新の状態に更新する」で確認してください。`; }
    finally { busy = false; render(); }
  }
  $('reload-groups').addEventListener('click', load);
  load();
})();
