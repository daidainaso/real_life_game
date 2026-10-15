"use strict";
(() => {
  const $ = id => document.getElementById(id), key = 'lifeGame.room.v2';
  let session, room, socket, active = false, pending = false, retry, timeout, syncTimer, syncing = false;
  try { session = JSON.parse(localStorage.getItem(key)); } catch {}
  $('resume-room').hidden = !session;
  let selectedGroup = 1;
  let groups = [], groupTimer, loadingGroups = false;
  function renderGroups() {
    const labels = { empty: '未作成', waiting: '参加受付中', playing: 'プレイ中', finished: '未作成', unknown: '確認できません' };
    for (let group = 1; group <= 8; group++) {
      const info = groups.find(item => item.group === group);
      const button = $(`room-group-${group}`);
      const title = document.createElement('strong');
      title.textContent = `グループ ${group}`;
      const status = document.createElement('span');
      status.textContent = info ? `${info.status === 'waiting' && info.count >= 12 ? '満員' : labels[info.status]}${['waiting', 'playing'].includes(info.status) ? ` · ${info.count}/12人` : ''}` : '確認中…';
      button.replaceChildren(title, status);
      button.setAttribute('data-status', info?.status === 'finished' ? 'empty' : info?.status || 'unknown');
      button.setAttribute('aria-pressed', String(group === selectedGroup));
      button.disabled = pending;
    }
    const selected = groups.find(item => item.group === selectedGroup);
    const canCreate = ['empty', 'finished'].includes(selected?.status);
    const canJoin = selected?.status === 'waiting' && selected.count < 12;
    $('enter-room').disabled = pending || !(canCreate || canJoin);
    $('enter-room').textContent = pending ? '接続しています…' : canCreate ? 'このグループで始める' : canJoin ? 'このグループに参加する' : selected?.status === 'playing' ? 'プレイ中です' : selected?.status === 'waiting' ? '満員です' : 'グループの状態を確認中です';
  }
  async function refreshGroups() {
    clearTimeout(groupTimer);
    if ($('room-entry').hidden || loadingGroups) return;
    loadingGroups = true;
    try { groups = (await api('/groups')).groups; }
    catch { groups = Array.from({ length: 8 }, (_, index) => ({ group: index + 1, status: 'unknown' })); }
    finally {
      loadingGroups = false;
      renderGroups();
      if (!$('room-entry').hidden) groupTimer = setTimeout(refreshGroups, 5000);
    }
  }
  for (let group = 1; group <= 8; group++) {
    $(`room-group-${group}`).addEventListener('click', () => {
      selectedGroup = group;
      renderGroups();
    });
  }
  function selectRoomAudience(value) {
    $('room-audience').value = value;
    for (const id of ['child', 'adult']) $(`room-audience-${id}`).setAttribute('aria-pressed', String(id === value));
  }
  for (const id of ['child', 'adult']) $(`room-audience-${id}`).addEventListener('click', () => selectRoomAudience(id));
  const message = text => {
    const element = $(active ? (room?.status === 'finished' ? 'room-result-notice' : 'room-message') : 'room-error');
    element.textContent = text; element.hidden = !text;
  };
  function render() {
    if (!room) return;
    if (active) {
      const finished = room.status === 'finished';
      const showResult = finished && $('room-result').hidden;
      $('room-play').hidden = finished;
      $('room-result').hidden = !finished;
      $('event-ranking').hidden = !finished;
      if (finished) {
        const player = room.players[room.yourIndex];
        $('room-result-money').textContent = LifeGame.amount(player.money);
        $('room-result-name').textContent = player.name;
        const sorted = room.players.map((p, index) => ({ ...p, index })).sort((a, b) => b.money - a.money);
        $('room-result-scores').replaceChildren(...sorted.map(p => {
          const li = document.createElement('li');
          li.textContent = `${sorted.findIndex(other => other.money === p.money) + 1}位 · ${p.index === room.yourIndex ? 'あなた · ' : ''}${p.name}：${LifeGame.amount(p.money)}`;
          return li;
        }));
        if (showResult) {
          $('announcement').textContent = 'ゲーム終了です。最終ランキングを確認してください。';
          document.dispatchEvent?.(new CustomEvent('room-result', { detail: { code: session.code, token: session.token } }));
          $('room-again').focus();
        }
      }
    }
    const connected = socket?.readyState === WebSocket.OPEN;
    const mine = room.status === 'playing' && room.turn === room.yourIndex;
    const goalReached = room.players[room.yourIndex].position >= room.goal;
    $('room-heading').textContent = `${room.group ? `グループ ${room.group}` : '参加中のグループ'} · ${audiences[room.audience].label}`;
    $('room-members').textContent = `参加者 ${room.players.length}人 / あなた：${room.players[room.yourIndex].name}`;
    $('room-status').textContent = room.status === 'finished' ? 'ゲーム終了です。最終ランキングを確認してください' : room.status === 'waiting' ? (room.host ? '参加者がそろったら開始してください。' : 'ホストが開始するまでお待ちください。') : mine ? (goalReached ? 'あなたの番です · ゴール後のボーナス' : 'あなたの番です') : `${room.players[room.turn].name}さんの番です`;
    $('room-status').classList.toggle('my-turn', mine);
    $('room-start').hidden = !room.host || room.status !== 'waiting';
    $('room-finish').hidden = !room.host || room.status !== 'playing';
    $('room-finish').disabled = !connected || pending;
    $('room-start').disabled = !connected || pending || room.players.length < 2;
    $('room-draw').hidden = room.status !== 'playing';
    $('room-draw').disabled = !connected || pending || !mine;
    $('room-draw').textContent = mine ? (goalReached ? 'ボーナスカードを引く ＋' : 'カードを引く ＋') : `${room.players[room.turn].name}さんの番です`;
    const last = room.last;
    $('room-icon').textContent = last?.card.icon || '✦';
    $('room-card').textContent = last ? `${last.name}さん${last.bonus ? '（ボーナス）' : ''}：${last.card.title}` : 'みんなで順番にカードを引きます';
    $('room-money').textContent = last ? LifeGame.change(last.card.money) : '全員の参加を待っています';
    $('room-money').className = `card-money ${!last || !last.card.money ? 'neutral' : last.card.money < 0 ? 'expense' : 'income'}`;
    $('room-move').textContent = last ? LifeGame.movement(last.card.move) : '移動は実際の盤面で行ってください';
    $('room-scores').replaceChildren(...room.players.map((player, index) => {
      const li = document.createElement('li');
      li.textContent = `${index === room.yourIndex ? 'あなた · ' : ''}${player.name}${index === 0 ? '（ホスト）' : ''}：${LifeGame.amount(player.money)} / 現在 ${player.position} / ${room.goal}マス${player.position >= room.goal ? ' · ゴール済み' : ''}`;
      li.classList.toggle('current-player', room.status === 'playing' && index === room.turn);
      return li;
    }));
  }
  function stop() {
    clearTimeout(retry); clearTimeout(timeout); clearTimeout(syncTimer); pending = false;
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
  }
  function connect() {
    stop();
    if (!active) return;
    const url = new URL(`./api/rooms/${session.code}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', session.token);
    const ws = socket = new WebSocket(url);
    message('グループに接続しています…'); render();
    ws.onopen = () => { message(''); render(); };
    ws.onmessage = event => {
      if (socket !== ws || !active) return;
      const data = JSON.parse(event.data);
      if (data.type === 'left') { exitRoom(); return; }
      clearTimeout(timeout); pending = false;
      if (data.type === 'error') message(data.error);
      if (data.type === 'state' || data.type === 'result') {
        if (!room || data.room.revision >= room.revision) room = data.room;
        render();
        scheduleSync();
      }
    };
    ws.onclose = () => {
      if (!active || socket !== ws) return;
      pending = false; clearTimeout(timeout); render();
      message('接続が切れました。再接続しています…');
      retry = setTimeout(connect, 2500);
    };
    ws.onerror = () => ws.close();
    scheduleSync();
  }
  function scheduleSync() {
    clearTimeout(syncTimer);
    if (active && room?.status !== 'finished') syncTimer = setTimeout(syncState, 5000);
  }
  async function syncState() {
    if (!active) return;
    if (syncing) return scheduleSync();
    const currentSession = session;
    syncing = true;
    try {
      const data = await api(`/${currentSession.code}`, null, true);
      if (!active || session !== currentSession) return;
      if (!room || data.room.revision >= room.revision) {
        if (!room || data.room.revision > room.revision || data.room.status === 'finished') {
          clearTimeout(timeout); pending = false;
        }
        room = data.room;
        render();
      }
    } catch { /* 次の確認またはWebSocketの再接続で復旧します。 */ }
    finally { syncing = false; if (active && session === currentSession) scheduleSync(); }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', syncState);
    window.addEventListener('focus', syncState);
  }
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncState();
  });
  async function api(route, input, authenticate = false) {
    const response = await fetch(route === '/groups' || route.startsWith('/groups/') ? `./api${route}` : `./api/rooms${route}`, {
      method: input ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(authenticate ? { Authorization: `Bearer ${session.token}` } : {}) },
      cache: 'no-store',
      body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '接続できませんでした。');
    return data;
  }
  function open() {
    active = true;
    $('event-ranking').hidden = true;
    for (const id of ['welcome', 'play', 'result', 'room-entry', 'room-result']) $(id).hidden = true;
    $('room-play').hidden = false; document.body.classList.add('room-open');
    connect();
  }
  async function enter(create) {
    if (pending) return;
    pending = true; renderGroups();
    try {
      const input = { name: $('player-name').value, audience: $('room-audience').value };
      if (create && typeof CardSettings !== 'undefined') {
        try { const settings = CardSettings.load(localStorage); input.cards = settings[input.audience]; input.bonusCards = settings.bonus[input.audience]; }
        catch { throw new Error('カード設定を読み込めません。設定画面で保存をやり直してからグループを作成してください。'); }
      }
      const data = await api(`/groups/${selectedGroup}/${create ? 'create' : 'join'}`, input);
      session = { code: data.room.code, token: data.token }; room = data.room;
      let saved = true;
      try { localStorage.setItem(key, JSON.stringify(session)); } catch { saved = false; }
      $('resume-room').hidden = false; open();
      if (!saved) message('参加情報を保存できません。再読み込みするとグループに戻れなくなります。');
    } catch (error) { message(error.message); }
    finally { pending = false; renderGroups(); render(); refreshGroups(); }
  }
  function action(type) {
    if (pending || socket?.readyState !== WebSocket.OPEN) return;
    pending = true; message(''); render();
    socket.send(JSON.stringify({ type, revision: room.revision }));
    // 応答不明の場合は再送せず、再接続で確定済み状態を取得します。
    timeout = setTimeout(connect, 10000);
  }
  $('group-mode').addEventListener('click', async () => {
    $('event-ranking').hidden = true;
    $('welcome').hidden = true; $('room-entry').hidden = false;
    selectRoomAudience($('audience').value);
    renderGroups();
    await refreshGroups();
  });
  $('room-back').addEventListener('click', () => { $('room-entry').hidden = true; $('welcome').hidden = false; $('event-ranking').hidden = false; });
  $('home').addEventListener('click', () => {
    active = false; stop();
    $('event-ranking').hidden = false;
    $('room-play').hidden = $('room-entry').hidden = $('room-result').hidden = true;
    $('welcome').hidden = false;
    document.body.classList.remove('room-open');
  });
  $('enter-room').addEventListener('click', () => {
    const selected = groups.find(item => item.group === selectedGroup);
    if (['empty', 'finished'].includes(selected?.status)) return enter(true);
    if (selected?.status === 'waiting' && selected.count < 12) return enter(false);
  });
  $('room-start').addEventListener('click', () => action('start'));
  $('room-draw').addEventListener('click', () => action('draw'));
  $('room-finish').addEventListener('click', () => {
    if (window.confirm('グループ全員のゲームを終了して、現在の所持金で結果を確定しますか？')) action('finish');
  });
  $('room-again').addEventListener('click', () => $('home').click());
  $('resume-room').addEventListener('click', async () => {
    if (pending || !session) return;
    pending = true;
    try { room = (await api(`/${session.code}`, null, true)).room; open(); }
    catch (error) { message(error.message); }
    finally { pending = false; render(); }
  });
  function exitRoom() {
    active = false; stop(); session = null; room = null;
    try { localStorage.setItem(key, 'null'); } catch {}
    $('resume-room').hidden = true;
    $('event-ranking').hidden = true;
    $('room-play').hidden = $('room-result').hidden = true; $('room-entry').hidden = false;
    document.body.classList.remove('room-open');
    renderGroups(); refreshGroups();
  }
  $('room-leave').addEventListener('click', async () => {
    if (pending || !session) return;
    if (!window.confirm('本当にグループを抜けますか？現在の参加情報は解除されます。')) return;
    pending = true; $('room-leave').disabled = true; render();
    try {
      await api(`/${session.code}/leave`, {}, true);
      exitRoom();
    } catch (error) { message(error.message); }
    finally { pending = false; $('room-leave').disabled = false; render(); }
  });
})();
