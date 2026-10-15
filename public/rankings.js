"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let saving = false;
  async function request(path = '', input, token) {
    const response = await fetch(`./api/${path || 'rankings'}`, {
      method: input ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ランキングを取得できませんでした。');
    return data;
  }
  function render(entries) {
    for (const audience of ['child', 'adult']) {
      const list = entries.filter(p => p.audience === audience).sort((a, b) => b.money - a.money);
      $(`ranking-${audience}`).replaceChildren(...list.map(p => {
        const li = document.createElement('li');
        li.textContent = `${list.findIndex(other => other.money === p.money) + 1}位 · ${p.name}：${LifeGame.amount(p.money)}（${p.source}）`;
        return li;
      }));
    }
    $('ranking-notice').textContent = entries.length ? '' : 'まだ登録された結果はありません。';
  }
  async function refresh() {
    try { render((await request()).entries); }
    catch (error) { $('ranking-notice').textContent = `${error.message}「最新のランキングに更新する」で再試行できます。`; }
  }
  async function registerRoom(event) {
    if ($('room-result').hidden) return;
    try {
      const session = event?.detail || JSON.parse(localStorage.getItem('lifeGame.room.v2'));
      if (session) render((await request(`rooms/${session.code}/ranking`, {}, session.token)).entries);
    } catch (error) { $('ranking-notice').textContent = `${error.message}「最新のランキングに更新する」で登録を再試行できます。`; }
  }
  document.addEventListener('room-result', registerRoom);
  document.addEventListener('game-result', refresh);
  $('ranking-refresh').addEventListener('click', async () => { await refresh(); await registerRoom(); });
  $('solo-ranking-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    try {
      const state = JSON.parse(localStorage.getItem(LifeGame.key));
      if (state?.status !== 'finished') throw new Error('保存済みの終了結果がありません。');
      state.rankingId ||= crypto.randomUUID();
      localStorage.setItem(LifeGame.key, JSON.stringify(state));
      render((await request('rankings', { id: state.rankingId, name: $('solo-ranking-name').value, money: state.money, audience: state.audience })).entries);
      $('solo-ranking-notice').textContent = 'ランキングに登録しました。同じ結果は重複登録されません。';
    } catch (error) { $('solo-ranking-notice').textContent = error.message; }
    finally { saving = false; }
  });
  refresh();
})();
