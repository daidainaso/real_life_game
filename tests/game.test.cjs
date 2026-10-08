const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const game = require("../script.js");
const root = path.join(__dirname, "..");
const config = { version: 1, initialMoney: 100000, goal: 50, eras: [{ id: "student", label: "学生", startAt: 0 }] };
const list = [
  { id: "a", era: "student", title: "収入", money: 10000, move: 2 },
  { id: "b", era: "student", title: "支出", money: -200000, move: -1 },
  { id: "c", era: "student", title: "休憩", money: 0, move: 0 },
];

test("10・30マスの自動切り替え、後退時の年代維持、50マスのゴール", () => {
  const cfg = { version: 3, initialMoney: 100000, goal: 50, eras: [
    { id: "student", label: "学生", startAt: 0 },
    { id: "adult", label: "社会人", startAt: 10 },
    { id: "senior", label: "老後", startAt: 30 },
  ] };
  const pool = [
    { id: "s", era: "student", title: "学生", money: 100, move: 10 },
    { id: "back", era: "adult", title: "戻る", money: -10, move: -2 },
    { id: "forward", era: "adult", title: "進む", money: 200, move: 22 },
    { id: "r", era: "senior", title: "老後", money: 300, move: 25 },
  ];
  let state = game.create(cfg, pool);
  state = game.draw(state, pool, cfg).state;
  assert.equal(state.position, 10);
  assert.equal(state.era, "adult");
  assert.equal(game.validState(state, cfg, pool), true);
  state.decks.adult.deck = ["forward", "back"];
  state = game.draw(state, pool, cfg).state;
  assert.equal(state.position, 8);
  assert.equal(state.era, "adult");
  state = game.draw(state, pool, cfg).state;
  assert.equal(state.position, 30);
  assert.equal(state.era, "senior");
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(game.validState(saved, cfg, pool), true);
  state = game.draw(saved, pool, cfg).state;
  assert.equal(state.position, 50);
  assert.equal(state.status, "finished");
  assert.equal(state.money, 100590);
  assert.equal(game.validState(state, cfg, pool), true);
  assert.throws(() => game.draw(state, pool, cfg));
  assert.equal(game.validState({ ...state, position: 51 }, cfg, pool), false);
  assert.equal(game.validState({ ...saved, era: "student" }, cfg, pool), false);
});

test("スタートより後ろに戻らず、境界を飛び越えた場合も年代が変わる", () => {
  const cfg = { ...config, eras: [config.eras[0], { id: "adult", label: "社会人", startAt: 10 }] };
  const pool = [{ ...list[0], move: -5 }, { ...list[1], move: 15 }, { ...list[2], era: "adult" }];
  let state = game.create(cfg, pool);
  state.decks.student.deck = ["b", "a"];
  state = game.draw(state, pool, cfg).state;
  assert.equal(state.position, 0);
  state = game.draw(state, pool, cfg).state;
  assert.equal(state.position, 15);
  assert.equal(state.era, "adult");
});

test("一巡で全カードを引き、各金額を一度だけ反映し、次の山札を作る", () => {
  let state = game.create(config, list);
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const result = game.draw(state, list, config);
    assert.equal(result.reshuffled, false);
    assert.equal(seen.has(result.card.id), false);
    seen.add(result.card.id);
    state = result.state;
    assert.equal(game.validState(state, config, list), true);
  }
  assert.equal(state.money, -90000);
  assert.equal(state.decks.student.deck.length, 0);
  const next = game.draw(state, list, config);
  assert.equal(next.reshuffled, true);
  assert.equal(next.state.decks.student.deck.length, 2);
  assert.equal(game.validState(next.state, config, list), true);
});

test("保存状態の破損と設定変更を拒否し、終了後の抽選を止める", () => {
  const state = game.create(config, list);
  for (const corrupt of [
    { ...state, decks: { student: { deck: ["a", "a", "c"], drawCount: 0 } } },
    { ...state, money: null },
    { ...state, decks: { student: { deck: ["unknown", "b", "c"], drawCount: 0 } } },
    { ...state, configVersion: 2 },
    { ...state, drawCount: -1 },
    { ...state, lastCardId: "a" },
  ]) assert.equal(game.validState(corrupt, config, list), false);
  assert.throws(() => game.draw({ ...state, status: "finished" }, list, config));
  assert.throws(() => game.validateConfig(config, []));
  assert.throws(() => game.validateConfig(config, [list[0], list[0]]));
});

test("金額と移動の正・負・ゼロを表示する", () => {
  assert.equal(game.change(10000), "＋10,000円");
  assert.equal(game.change(-10000), "−10,000円");
  assert.equal(game.change(0), "所持金の増減なし");
  assert.equal(game.amount(-10000), "−10,000円");
  assert.equal(game.movement(2), "2マス進む");
  assert.equal(game.movement(-2), "2マス戻る");
  assert.equal(game.movement(0), "移動なし");
});

function loadApp(raw = null, failStorage = false) {
  const elements = new Map();
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  function element() {
    const listeners = {};
    return {
      hidden: false, disabled: false, textContent: "", returnValue: "",
      children: [], attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); },
      classList: { add() { }, remove() { } },
      addEventListener(event, fn) { listeners[event] = fn; },
      focus() { }, showModal() { this.open = true; },
      click() { if (!this.disabled) listeners.click?.(); },
      close(value) { this.returnValue = value; this.open = false; listeners.close?.(); },
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    elements.set(match[1], element());
  }
  const store = new Map(raw === null ? [] : [[game.key, raw]]);
  const timers = [];
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: () => element() },
    localStorage: {
      getItem(key) { if (failStorage) throw new Error("blocked"); return store.get(key) ?? null; },
      setItem(key, value) { if (failStorage) throw new Error("blocked"); store.set(key, value); },
    },
    setTimeout(fn) { timers.push(fn); },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "cards.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), context);
  return { el: id => elements.get(id), record: () => store.get(game.key), tick: () => timers.splice(0).forEach(fn => fn()) };
}

test("開始・連打防止・再開・確認キャンセル・終了を画面処理で検証する", () => {
  const app = loadApp();
  app.el("start").click();
  app.el("draw").click();
  app.el("draw").click();
  const saved = app.record();
  assert.equal(JSON.parse(saved).drawCount, 1);
  const reload = loadApp(saved);
  reload.el("resume").click();
  assert.equal(reload.record(), saved);
  assert.equal(reload.el("money").textContent, app.el("money").textContent);
  assert.equal(reload.el("card-title").textContent, app.el("card-title").textContent);
  reload.el("restart").click();
  reload.el("confirm-dialog").close("cancel");
  assert.equal(reload.record(), saved);
  reload.el("finish").click();
  reload.el("confirm-dialog").close("ok");
  const finished = reload.record();
  assert.equal(JSON.parse(finished).status, "finished");
  reload.el("draw").click();
  assert.equal(reload.record(), finished);
  assert.equal(loadApp(finished).el("result").hidden, false);
  reload.el("again").click();
  reload.el("confirm-dialog").close("ok");
  assert.equal(JSON.parse(reload.record()).drawCount, 0);
  assert.equal(JSON.parse(reload.record()).money, 100000);
});

test("壊れた記録を勝手に上書きせず、保存できない環境でも遊べる", () => {
  const broken = loadApp("{broken");
  assert.match(broken.el("notice").textContent, /再開できません/);
  broken.el("start").click();
  broken.el("confirm-dialog").close("cancel");
  assert.equal(broken.record(), "{broken");
  const blocked = loadApp(null, true);
  blocked.el("start").click();
  blocked.el("draw").click();
  assert.match(blocked.el("notice").textContent, /保存できない/);
  assert.equal(blocked.el("play").hidden, false);
  assert.notEqual(blocked.el("card-title").textContent, "どんな人生が待っていますか？");
});

