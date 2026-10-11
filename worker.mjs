import cardData from './public/cards.js';
import game from './public/script.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) fail('名前を1〜24文字で入力してください。');
  return value.trim();
};
async function body(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('JSONで送信してください。', 415);
  const raw = await request.text();
  if (raw.length > 4096) fail('入力が長すぎます。', 413);
  let value;
  try { value = JSON.parse(raw); } catch { fail('入力を確認してください。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('入力を確認してください。');
  return value;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) fail('この接続元からは操作できません。', 403);
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const input = await body(request);
        validName(input.name); cardData.audienceGame(input.audience);
        for (let attempt = 0; attempt < 10; attempt++) {
          const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const response = await stub.fetch(new Request(`${url.origin}/api/rooms/${code}/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
          }));
          if (response.status !== 409) return response;
        }
        fail('部屋を作れませんでした。もう一度お試しください。', 503);
      }
      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|socket))?$/);
      if (!match) fail('部屋番号を確認してください。', 404);
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    } catch (error) { return json({ error: error.message }, error.status || 400); }
  },
};

export class GameRoom {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room');
      if (this.room) {
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
    if (!player) fail('この部屋への参加情報がありません。', 403);
    return player;
  }
  view(player) {
    const r = this.room;
    return { code: r.code, audience: r.audience, status: r.finished ? 'finished' : r.started ? 'playing' : 'waiting', revision: r.revision,
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
        if (action === 'create' && request.method === 'POST') {
          if (this.room) fail('この番号は使用中です。', 409);
          const input = await body(request), settings = cardData.audienceGame(input.audience);
          const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: validName(input.name), money: settings.config.initialMoney, position: 0 };
          this.room = { code: url.pathname.split('/')[3], audience: input.audience, cards: settings.cards,
            initialMoney: settings.config.initialMoney, goal: settings.config.goal, players: [player], turn: 0, started: false, finished: false,
            bonusCards: cardData.bonusCards[input.audience], bonusDeck: [], bonusDeckIndex: 0,
            deck: [], deckIndex: 0, revision: 0, last: null };
          await this.ctx.storage.put('room', this.room);
          return json({ token: player.token, room: this.view(player) }, 201);
        }
        if (!this.room) fail('部屋が見つかりません。番号を確認してください。', 404);
        if (action === 'join' && request.method === 'POST') {
          if (this.room.started) fail('開始済みの部屋には参加できません。', 409);
          if (this.room.players.length >= 12) fail('部屋は満員です（最大12人）。', 409);
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
