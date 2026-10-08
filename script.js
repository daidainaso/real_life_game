"use strict";

// DOMに依存しないゲーム処理。Node.jsからも検証できます。
const LifeGame = (() => {
  const key = "lifeGame.state";
  function validateConfig(config, list) {
    if (!config || !Number.isSafeInteger(config.version) || config.version < 1 || !Number.isSafeInteger(config.initialMoney) || !Array.isArray(list) || !list.length) throw new Error("ゲームの設定を確認してください。");
    const ids = new Set();
    if (!Array.isArray(config.eras) || !config.eras.length) throw new Error("年代の設定を確認してください。");
    if (!Number.isSafeInteger(config.goal) || config.goal < 1) throw new Error("ゴールの設定を確認してください。");
    const eraIds = new Set();
    for (const era of config.eras) {
      if (!era || typeof era.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(era.id) || eraIds.has(era.id) || typeof era.label !== "string" || !era.label.trim()) throw new Error("年代のID・名称を確認してください。");
      eraIds.add(era.id);
    }
    if (config.eras.some((era, index) => !Number.isSafeInteger(era.startAt) || era.startAt < 0 || era.startAt >= config.goal || (index === 0 ? era.startAt !== 0 : era.startAt <= config.eras[index - 1].startAt))) throw new Error("年代の開始マスを確認してください。");
    for (const card of list) {
      if (!card || typeof card.id !== "string" || !card.id.trim() || ids.has(card.id) || typeof card.title !== "string" || !card.title.trim() || !Number.isSafeInteger(card.money) || !Number.isSafeInteger(card.move)) throw new Error("カードのID・内容・金額・移動数を確認してください。");
      ids.add(card.id);
      if (!eraIds.has(card.era)) throw new Error("カードの年代を確認してください。");
    }
    if (config.eras.some(era => !list.some(card => card.era === era.id))) throw new Error("各年代に1枚以上のカードを設定してください。");
  }
  function shuffle(list, random = Math.random) {
    const deck = list.map(card => card.id);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function create(config, list) {
    validateConfig(config, list);
    const decks = Object.fromEntries(config.eras.map(era => [era.id, { deck: shuffle(list.filter(card => card.era === era.id)), drawCount: 0 }]));
    return { schemaVersion: 3, configVersion: config.version, status: "playing", money: config.initialMoney, position: 0, furthestPosition: 0, era: config.eras[0].id, decks, lastCardId: null, drawCount: 0 };
  }
  function validState(state, config, list) {
    if (!state || state.schemaVersion !== 3 || state.configVersion !== config.version || !["playing", "finished"].includes(state.status) || !Number.isSafeInteger(state.money) || !Number.isSafeInteger(state.drawCount) || state.drawCount < 0 || !config.eras.some(era => era.id === state.era) || !state.decks || typeof state.decks !== "object" || Array.isArray(state.decks) || Object.keys(state.decks).length !== config.eras.length) return false;
    if (!Number.isSafeInteger(state.position) || !Number.isSafeInteger(state.furthestPosition) || state.position < 0 || state.position > state.furthestPosition || state.furthestPosition > config.goal || (state.position === config.goal && state.status !== "finished")) return false;
    if (config.eras.filter(era => era.startAt <= state.furthestPosition).at(-1).id !== state.era) return false;
    let count = 0;
    for (const era of config.eras) {
      const pool = list.filter(card => card.era === era.id);
      const ids = new Set(pool.map(card => card.id));
      const saved = state.decks[era.id];
      if (!saved || !Number.isSafeInteger(saved.drawCount) || saved.drawCount < 0 || !Array.isArray(saved.deck) || new Set(saved.deck).size !== saved.deck.length || !saved.deck.every(id => ids.has(id))) return false;
      const expected = saved.drawCount === 0 ? pool.length : (pool.length - saved.drawCount % pool.length) % pool.length;
      if (saved.deck.length !== expected) return false;
      count += saved.drawCount;
    }
    if (!Number.isSafeInteger(count) || count !== state.drawCount) return false;
    if (state.drawCount === 0 && (state.money !== config.initialMoney || state.lastCardId !== null || state.furthestPosition !== 0)) return false;
    if (state.lastCardId === null) return true;
    const last = list.find(card => card.id === state.lastCardId);
    return !!last && state.decks[last.era].drawCount > 0 && !state.decks[last.era].deck.includes(last.id);
  }
  function draw(state, list, config) {
    if (state.status !== "playing") throw new Error("終了したゲームではカードを引けません。");
    const current = state.decks[state.era];
    const reshuffled = current.deck.length === 0;
    const deck = reshuffled ? shuffle(list.filter(card => card.era === state.era)) : [...current.deck];
    const id = deck.pop();
    const card = list.find(item => item.id === id);
    const money = state.money + card.money;
    if (!Number.isSafeInteger(money) || !Number.isSafeInteger(state.drawCount + 1)) throw new Error("計算できる範囲を超えました。ゲームを終了してください。");
    const decks = { ...state.decks, [state.era]: { deck, drawCount: current.drawCount + 1 } };
    const position = Math.max(0, Math.min(config.goal, state.position + card.move));
    const furthestPosition = Math.max(state.furthestPosition, position);
    const era = config.eras.filter(item => item.startAt <= furthestPosition).at(-1).id;
    return { state: { ...state, decks, money, position, furthestPosition, era, status: position === config.goal ? "finished" : "playing", lastCardId: id, drawCount: state.drawCount + 1 }, card, reshuffled, eraChanged: era !== state.era };
  }
  function movement(move) { return move > 0 ? `${move}マス進む` : move < 0 ? `${Math.abs(move)}マス戻る` : "移動なし"; }
  function amount(money) { return `${money < 0 ? "−" : ""}${Math.abs(money).toLocaleString("ja-JP")}円`; }
  function change(money) { return money === 0 ? "所持金の増減なし" : `${money > 0 ? "＋" : "−"}${Math.abs(money).toLocaleString("ja-JP")}円`; }
  return { key, validateConfig, shuffle, create, validState, draw, movement, amount, change };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LifeGame;
if (typeof document !== "undefined") initializeGame();
if (typeof window !== "undefined") initializeViewportFit();

function initializeViewportFit() {
  const app = document.querySelector(".app");
  let scheduled = false;
  function fit() {
    scheduled = false;
    // ピンチ操作での拡大は維持します。通常表示と端末回転時に調整します。
    if (window.visualViewport && window.visualViewport.scale !== 1) return;
    const availableHeight = window.visualViewport?.height ?? window.innerHeight;
    const contentHeight = Math.max(app.offsetHeight, app.scrollHeight);
    const scale = Math.min(1, Math.max(1, availableHeight - 8) / Math.max(1, contentHeight));
    app.style.setProperty("--app-scale", String(scale));
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(fit);
  }
  document.body.classList.add("viewport-fit");
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(app);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  document.fonts?.ready.then(schedule);
  fit();
}

function initializeGame() {
  const $ = id => document.getElementById(id);
  let state = null;
  let hasRecord = false;
  let storageAvailable = true;
  let busy = false;
  let pendingAction = null;
  function notice(message) { $("notice").textContent = message; $("notice").hidden = false; }
  function storageFailure() {
    storageAvailable = false;
    notice("このブラウザでは保存できないため、再読み込みすると続きから再開できません。");
  }
  function save() {
    hasRecord = true;
    if (!storageAvailable) return;
    try { localStorage.setItem(LifeGame.key, JSON.stringify(state)); } catch { storageFailure(); }
  }
  function screen(name) { for (const id of ["welcome", "play", "result"]) $(id).hidden = id !== name; }
  function showPlay() {
    screen("play");
    $("money").textContent = LifeGame.amount(state.money);
    $("position").textContent = `${state.position} / ${gameConfig.goal}マス`;
    $("board-progress").max = gameConfig.goal;
    $("board-progress").value = state.position;
    const card = cards.find(item => item.id === state.lastCardId);
    const eraLabel = gameConfig.eras.find(era => era.id === state.era).label;
    $("current-era").textContent = eraLabel;
    $("card-icon").textContent = card ? card.icon || "✦" : "✦";
    $("card-title").textContent = card ? card.title : "どんな人生が待っていますか？";
    $("card-money").textContent = card ? LifeGame.change(card.money) : "カードを引いて始めましょう";
    $("card-money").className = `card-money ${!card || card.money === 0 ? "neutral" : card.money < 0 ? "expense" : "income"}`;
    $("card-move").textContent = card ? LifeGame.movement(card.move) : "表示された数だけ移動します";
  }
  function showResult() {
    screen("result");
    $("result-message").textContent = state.position === gameConfig.goal ? `${gameConfig.goal}マス目まで進んでゴールです。結果をスタッフに見せてください。` : "ゲームを終了しました。結果をスタッフに見せてください。";
    $("result-money").textContent = LifeGame.amount(state.money);
    $("result-count").textContent = `${state.drawCount}枚のカードで、人生を歩みました。`;
  }
  function start() {
    state = LifeGame.create(gameConfig, cards);
    save();
    showPlay();
    $("draw").focus();
    $("announcement").textContent = `ゲームを開始しました。所持金は${LifeGame.amount(state.money)}です。`;
  }
  function confirmAction(title, description, label, action) {
    pendingAction = action;
    $("dialog-title").textContent = title;
    $("dialog-description").textContent = description;
    $("confirm-ok").textContent = label;
    $("confirm-dialog").returnValue = "cancel";
    $("confirm-dialog").showModal();
  }
  function requestStart() {
    if (hasRecord) confirmAction("新しく始めますか？", "現在の記録を消し、初期所持金から新しいゲームを始めます。", "新しく始める", start);
    else start();
  }
  $("confirm-dialog").addEventListener("close", () => {
    const action = pendingAction;
    pendingAction = null;
    if ($("confirm-dialog").returnValue === "ok" && action) action();
  });
  for (const id of ["start", "new-game", "restart", "again"]) $(id).addEventListener("click", requestStart);
  $("resume").addEventListener("click", () => { showPlay(); $("draw").focus(); });
  $("finish").addEventListener("click", () => confirmAction("途中で終了しますか？", "50マスに到着すると自動でゴールします。今終了すると、これ以上カードを引けなくなります。", "終了する", () => {
    state = { ...state, status: "finished" };
    save(); showResult(); $("again").focus();
  }));
  $("draw").addEventListener("click", () => {
    if (busy || !state || state.status !== "playing") return;
    busy = true;
    $("draw").disabled = true;
    try {
      const result = LifeGame.draw(state, cards, gameConfig);
      state = result.state;
      save(); showPlay();
      $("card").classList.remove("reveal");
      void $("card").offsetWidth;
      $("card").classList.add("reveal");
      $("announcement").textContent = `${result.reshuffled ? "山札を再シャッフルしました。" : ""}${result.card.title}。${LifeGame.change(result.card.money)}。${LifeGame.movement(result.card.move)}。現在の所持金は${LifeGame.amount(state.money)}です。`;
      if (result.eraChanged) $("announcement").textContent += `${gameConfig.eras.find(era => era.id === state.era).label}になりました。`;
      if (state.status === "finished") { showResult(); $("again").focus(); $("announcement").textContent += `${gameConfig.goal}マスに到着しました。ゴールです。`; }
    } catch (error) { notice(error.message); }
    finally { setTimeout(() => { busy = false; $("draw").disabled = false; }, 600); }
  });
  try { LifeGame.validateConfig(gameConfig, cards); }
  catch (error) { notice(error.message); $("start").disabled = true; return; }
  $("welcome-money").textContent = LifeGame.amount(gameConfig.initialMoney);
  try {
    const raw = localStorage.getItem(LifeGame.key);
    hasRecord = raw !== null;
    if (raw !== null) {
      try {
        const saved = JSON.parse(raw);
        if (!LifeGame.validState(saved, gameConfig, cards)) throw new Error("invalid state");
        state = saved;
      } catch { notice("保存済みの記録を再開できません。設定が変更されたか、記録が壊れています。新しくゲームを始めてください。"); }
    }
  } catch { storageFailure(); }
  if (state?.status === "finished") showResult();
  else if (state) {
    $("welcome-label").textContent = "保存済みの所持金";
    $("welcome-money").textContent = LifeGame.amount(state.money);
    $("start").hidden = true; $("resume").hidden = false; $("new-game").hidden = false;
  }
}
