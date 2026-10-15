import cardData from './public/cards.js';
import game from './public/script.js';
import cardSettings from './public/card-settings-store.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) fail('名前を1〜24文字で入力してください。');
  return value.trim();
};
async function body(request, maxLength = 4096) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('JSONで送信してください。', 415);
  const raw = await request.text();
  if (raw.length > maxLength) fail('入力が長すぎます。', 413);
  let value;
  try { value = JSON.parse(raw); } catch { fail('入力を確認してください。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('入力を確認してください。');
  return value;
}

function roomSettings(input) {
  const settings = cardData.audienceGame(input.audience);
  settings.bonusCards = Object.hasOwn(input, 'bonusCards') ? cardSettings.validateCards(input.bonusCards, true) : cardData.bonusCards[input.audience];
  if (Object.hasOwn(input, 'cards')) {
    settings.cards = cardSettings.validateCards(input.cards).map(card => ({ ...card, era: input.audience }));
    game.validateConfig(settings.config, settings.cards);
  }
  return settings;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) fail('この接続元からは操作できません。', 403);
      if (url.pathname === '/api/rankings' || url.pathname === '/api/rankings/paper') {
        const stub = env.ROOMS.get(env.ROOMS.idFromName('event-rankings'));
        if (request.method === 'GET' && url.pathname === '/api/rankings') return stub.fetch(request);
        if (request.method !== 'POST') fail('対応していない操作です。', 405);
        const input = await body(request, 32768);
        const paper = url.pathname.endsWith('/paper');
        const items = paper && Array.isArray(input.entries) ? input.entries : [input];
        if (!items.length || items.length > 100) fail('1〜100人分の結果を入力してください。');
        const entries = items.map(item => {
          if (!item || !['child', 'adult'].includes(item.audience) || !Number.isSafeInteger(item.money)) fail('区分と所持金を確認してください。');
          if (typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(item.id)) fail('登録情報を確認してください。');
          const source = paper ? (item.source ?? 'ひとり') : 'ひとり';
          if (!['グループ', 'ひとり'].includes(source)) fail('参加形式を選択してください。');
          return { id: `${paper ? 'paper' : 'solo'}-${item.id}`, name: validName(item.name), money: item.money, audience: item.audience, source };
        });
        return stub.fetch(new Request('https://internal/rankings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }) }));
      }
      const rankingRoom = url.pathname.match(/^\/api\/rooms\/(\d{6})\/ranking$/);
      if (rankingRoom && request.method === 'POST') {
        const response = await env.ROOMS.get(env.ROOMS.idFromName(rankingRoom[1])).fetch(new Request(`${url.origin}/api/rooms/${rankingRoom[1]}`, { headers: request.headers }));
        if (!response.ok) return response;
        const { room } = await response.json();
        if (room.status !== 'finished') fail('終了後に登録してください。', 409);
        return env.ROOMS.get(env.ROOMS.idFromName('event-rankings')).fetch(new Request('https://internal/rankings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: room.players.map(p => ({ id: p.id, name: p.name, money: p.money, audience: room.audience, source: 'グループ' })) }),
        }));
      }
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const input = await body(request, 131072);
        validName(input.name); roomSettings(input);
        for (let attempt = 0; attempt < 10; attempt++) {
          const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const response = await stub.fetch(new Request(`${url.origin}/api/rooms/${code}/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
          }));
          if (response.status !== 409) return response;
        }
        fail('グループを作れませんでした。もう一度お試しください。', 503);
      }
      if (['/api/groups', '/api/admin/groups'].includes(url.pathname) && request.method === 'GET') {
        const groups = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
          const response = await env.ROOMS.get(env.ROOMS.idFromName(`group-${index + 1}`)).fetch(new Request(`https://internal/api/groups/${index + 1}/${url.pathname === '/api/admin/groups' ? 'admin-status' : 'status'}`));
          if (!response.ok) return { group: index + 1, status: 'unknown' };
          return response.json();
        }));
        return json({ groups });
      }
      const adminFinish = url.pathname.match(/^\/api\/admin\/groups\/([1-8])\/finish$/);
      if (adminFinish && request.method === 'POST') {
        const input = await body(request);
        return env.ROOMS.get(env.ROOMS.idFromName(`group-${adminFinish[1]}`)).fetch(new Request(`https://internal/api/groups/${adminFinish[1]}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
      }
      const group = url.pathname.match(/^\/api\/groups\/([1-8])\/(create|join)$/);
      if (group && request.method === 'POST') {
        const input = await body(request, 131072);
        return env.ROOMS.get(env.ROOMS.idFromName(`group-${group[1]}`)).fetch(new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
      }
      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|socket|leave))?$/);
      if (!match) fail('グループ番号を確認してください。', 404);
      if (match[2] === 'leave' && request.method === 'POST') {
        await body(request);
        return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(new Request(request.url, { method: 'POST', headers: request.headers }));
      }
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    } catch (error) { return json({ error: error.message }, error.status || 400); }
  },
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room');
      if (this.room) {
        this.room.controlToken ??= this.room.players[0]?.token;
        this.room.goal ??= 50;
        for (const player of this.room.players) player.position ??= 0;
        this.room.bonusCards ??= cardData.bonusCards[this.room.audience];
        this.room.bonusDeck ??= game.shuffle(this.room.bonusCards);
        this.room.bonusDeckIndex ??= 0;
        this.room.finished ??= this.room.started && this.room.players.every(p => p.position >= this.room.goal);
      }
    });
  }
  member(token) {
    const player = this.room?.players.find(p => p.token === token);
    if (!player) fail('このグループへの参加情報がありません。', 403);
    return player;
  }
  view(player) {
    const r = this.room;
    return { code: r.code, group: r.group, audience: r.audience, status: r.finished ? 'finished' : r.started ? 'playing' : 'waiting', revision: r.revision,
      host: r.players[0].id === player.id, yourIndex: r.players.indexOf(player), turn: r.turn, last: r.last,
      goal: r.goal, players: r.players.map(p => ({ id: p.id, name: p.name, money: p.money, position: p.position, finished: p.position >= r.goal })) };
  }
  broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: 'state', room: this.view(this.member(ws.deserializeAttachment().token)) })); }
      catch { try { ws.close(1011, '再接続してください'); } catch {} }
    }
  }
  async fetch(request) {
    // Storage I/Oをまたぐ参加・作成も直列化します。
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(request.url), action = url.pathname.split('/').at(-1);
        const groupFinish = url.pathname.match(/^\/api\/groups\/([1-8])\/finish$/);
        if (groupFinish && request.method === 'POST') {
          const input = await body(request);
          const current = await this.ctx.storage.get('groupSession');
          if (!current) fail('このグループは未作成です。', 404);
          if (input.code !== current.code) fail('グループが作り直されています。一覧を更新してください。', 409);
          return this.env.ROOMS.get(this.env.ROOMS.idFromName(current.code)).fetch(new Request(`https://internal/api/rooms/${current.code}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${current.token}` } }));
        }
        const groupStatus = url.pathname.match(/^\/api\/groups\/([1-8])\/(status|admin-status)$/);
        if (groupStatus && request.method === 'GET') {
          const current = await this.ctx.storage.get('groupSession');
          if (!current) return json({ group: Number(groupStatus[1]), status: 'empty', count: 0 });
          const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(current.code)).fetch(new Request(`https://internal/api/rooms/${current.code}/control`, { headers: { Authorization: `Bearer ${current.token}` } }));
          if (!response.ok) return json({ group: Number(groupStatus[1]), status: 'unknown' });
          const { room } = await response.json();
          return json({ group: Number(groupStatus[1]), status: room.status, count: room.players.length, audience: room.audience,
            ...(action === 'admin-status' ? { code: current.code } : {}) });
        }
        const group = url.pathname.match(/^\/api\/groups\/([1-8])\/(create|join)$/);
        if (group && request.method === 'POST') {
          const current = await this.ctx.storage.get('groupSession');
          if (action === 'join') {
            if (!current) fail('このグループはまだ作成されていません。ホストが作成するまでお待ちください。', 404);
            return this.env.ROOMS.get(this.env.ROOMS.idFromName(current.code)).fetch(new Request(`https://internal/api/rooms/${current.code}/join`, request));
          }
          if (current) {
            const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(current.code)).fetch(new Request(`https://internal/api/rooms/${current.code}/control`, { headers: { Authorization: `Bearer ${current.token}` } }));
            if (!response.ok) fail('グループの状態を確認できません。もう一度お試しください。', 503);
            if ((await response.json()).room.status !== 'finished') fail('このグループは使用中です。参加するか、別のグループを選んでください。', 409);
          }
          const input = await body(request, 131072);
          input.group = Number(group[1]);
          for (let attempt = 0; attempt < 10; attempt++) {
            const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
            const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).fetch(new Request(`https://internal/api/rooms/${code}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
            if (response.status === 409) continue;
            if (!response.ok) return response;
            const data = await response.json();
            await this.ctx.storage.put('groupSession', { code, token: data.token });
            return json(data, 201);
          }
          fail('グループを作成できませんでした。もう一度お試しください。', 503);
        }
        if (url.pathname === '/api/rankings' || url.pathname === '/rankings') {
          const entries = await this.ctx.storage.get('rankings') || [];
          if (request.method === 'POST') {
            const input = await body(request, 32768);
            for (const entry of input.entries) if (!entries.some(e => e.id === entry.id)) entries.push(entry);
            await this.ctx.storage.put('rankings', entries);
          }
          return json({ entries: entries.sort((a, b) => b.money - a.money) });
        }
        if (action === 'create' && request.method === 'POST') {
          if (this.room) fail('この番号は使用中です。', 409);
          const input = await body(request, 131072), settings = roomSettings(input);
          const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: validName(input.name), money: settings.config.initialMoney, position: 0 };
          this.room = { code: url.pathname.split('/')[3], controlToken: player.token, group: input.group, audience: input.audience, cards: settings.cards,
            initialMoney: settings.config.initialMoney, goal: settings.config.goal, players: [player], turn: 0, started: false, finished: false,
            bonusCards: settings.bonusCards, bonusDeck: [], bonusDeckIndex: 0,
            deck: [], deckIndex: 0, revision: 0, last: null };
          await this.ctx.storage.put('room', this.room);
          return json({ token: player.token, room: this.view(player) }, 201);
        }
        if (!this.room) fail('グループが見つかりません。番号を確認してください。', 404);
        if (action === 'control' && request.method === 'GET') {
          if (request.headers.get('Authorization') !== `Bearer ${this.room.controlToken}`) fail('管理情報を確認できません。', 403);
          return json({ room: { audience: this.room.audience, status: this.room.finished ? 'finished' : this.room.started ? 'playing' : 'waiting', players: this.room.players.map(p => ({ id: p.id })) } });
        }
        if (action === 'leave' && request.method === 'POST') {
          const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
          const r = this.room;
          if (r.leftTokens?.includes(token)) return json({ left: true });
          const player = this.member(token), index = r.players.indexOf(player);
          r.players.splice(index, 1);
          (r.leftTokens ||= []).push(token);
          if (index < r.turn) r.turn--;
          r.turn = r.players.length ? r.turn % r.players.length : 0;
          if (!r.players.length || (r.started && r.players.every(p => p.position >= r.goal))) r.finished = true;
          r.revision++;
          await this.ctx.storage.put('room', r);
          for (const ws of this.ctx.getWebSockets()) {
            if (ws.deserializeAttachment().token === token) {
              try { ws.send(JSON.stringify({ type: 'left' })); ws.close(1000, '退出しました'); } catch {}
            }
          }
          this.broadcast();
          return json({ left: true });
        }
        if (action === 'finish' && request.method === 'POST') {
          if (request.headers.get('Authorization') !== `Bearer ${this.room.controlToken}`) fail('管理情報を確認できません。', 403);
          if (!this.room.finished) {
            this.room.finished = true;
            this.room.revision++;
            await this.ctx.storage.put('room', this.room);
            this.broadcast();
          }
          return json({ finished: true });
        }
        if (action === 'join' && request.method === 'POST') {
          if (this.room.started) fail('開始済みのグループには参加できません。', 409);
          if (this.room.players.length >= 12) fail('グループは満員です（最大12人）。', 409);
          const input = await body(request), name = validName(input.name);
          if (this.room.players.some(p => p.name === name)) fail('別の名前を入力してください。');
          const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, money: this.room.initialMoney, position: 0 };
          this.room.players.push(player); this.room.revision++;
          await this.ctx.storage.put('room', this.room); this.broadcast();
          return json({ token: player.token, room: this.view(player) }, 201);
        }
        const player = this.member(request.headers.get('Authorization')?.replace(/^Bearer /, '') || url.searchParams.get('token'));
        if (action === 'socket' && request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
          const [client, server] = Object.values(new WebSocketPair());
          this.ctx.acceptWebSocket(server); server.serializeAttachment({ token: player.token });
          server.send(JSON.stringify({ type: 'state', room: this.view(player) }));
          return new Response(null, { status: 101, webSocket: client });
        }
        if (request.method === 'GET' && /^\d{6}$/.test(action)) return json({ room: this.view(player) });
        fail('対応していない操作です。', 405);
      } catch (error) { return json({ error: error.message }, error.status || 400); }
    });
  }
  async webSocketMessage(ws, raw) {
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (typeof raw !== 'string' || raw.length > 4096) fail('入力を確認してください。');
        const message = JSON.parse(raw), player = this.member(ws.deserializeAttachment().token), r = this.room;
        if (!message || message.revision !== r.revision) fail('状態が更新されました。もう一度操作してください。', 409);
        if (message.type === 'start') {
          if (r.players[0] !== player) fail('ホストだけが開始できます。', 403);
          if (r.started || r.players.length < 2) fail('2人以上そろってから開始してください。', 409);
          r.started = true; r.deck = game.shuffle(r.cards); r.deckIndex = 0;
          r.bonusDeck = game.shuffle(r.bonusCards); r.bonusDeckIndex = 0;
        } else if (message.type === 'finish') {
          if (r.players[0] !== player) fail('ホストだけが終了できます。', 403);
          if (!r.started || r.finished) fail('進行中のゲームだけ終了できます。', 409);
          r.finished = true;
        } else if (message.type === 'draw') {
          if (r.finished) fail('ゲームは終了しています。', 409);
          if (!r.started || r.players[r.turn] !== player) fail('現在はあなたの番ではありません。', 403);
          const bonus = player.position >= r.goal;
          const deckKey = bonus ? 'bonusDeck' : 'deck', indexKey = bonus ? 'bonusDeckIndex' : 'deckIndex';
          const pool = bonus ? r.bonusCards : r.cards;
          if (r[indexKey] === r[deckKey].length) { r[deckKey] = game.shuffle(pool); r[indexKey] = 0; }
          const card = pool.find(c => c.id === r[deckKey][r[indexKey]]);
          if (!Number.isSafeInteger(player.money + card.money)) fail('計算できる範囲を超えました。');
          player.money += card.money;
          if (!bonus) player.position = Math.max(0, Math.min(r.goal, player.position + card.move));
          r[indexKey]++;
          r.last = { name: player.name, card, bonus };
          r.finished = r.players.every(p => p.position >= r.goal);
          if (!r.finished) r.turn = (r.turn + 1) % r.players.length;
        } else fail('対応していない操作です。');
        r.revision++; await this.ctx.storage.put('room', r); this.broadcast();
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', error: error.message }));
        this.broadcast();
      }
    });
  }
  webSocketClose(ws, code, reason) { ws.close(code, reason); }
  webSocketError(ws) { try { ws.close(1011, '再接続してください'); } catch {} }
}
