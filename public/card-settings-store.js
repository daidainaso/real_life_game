"use strict";
const CardSettings = (() => {
  const key = "lifeGame.cardSettings.v1";
  function defaults() {
    return { ...Object.fromEntries(["child", "adult"].map(id => [id, audienceGame(id).cards.map(({ era, ...card }) => card)])), bonus: Object.fromEntries(["child", "adult"].map(id => [id, bonusCards[id].map(card => ({ ...card }))])) };
  }
  function validateCards(list, bonus = false) {
      if (!Array.isArray(list) || list.length < 1 || list.length > 200) throw new Error("子供・大人それぞれに1〜200枚のカードを設定してください。");
      const ids = new Set();
      const result = list.map(card => {
        if (!card || typeof card.id !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(card.id) || ids.has(card.id)) throw new Error("カードIDが不正か、重複しています。");
        if (typeof card.title !== "string" || !card.title.trim() || card.title.trim().length > 120) throw new Error("内容を1〜120文字で入力してください。");
        if (!Number.isSafeInteger(card.money) || Math.abs(card.money) > 100000000) throw new Error("金額は−100,000,000〜100,000,000の整数で入力してください。");
        if (!Number.isSafeInteger(card.move) || Math.abs(card.move) > 50) throw new Error("移動数は−50〜50の整数で入力してください。");
        if (typeof card.icon !== "string" || card.icon.length > 16) throw new Error("アイコンは16文字以内で入力してください。");
        ids.add(card.id);
        return { id: card.id, title: card.title.trim(), money: card.money, move: card.move, icon: card.icon.trim() || "✦" };
      });
      if (bonus && result.some(card => card.move !== 0)) throw new Error("ボーナスカードの移動数は0にしてください。");
      if (!bonus && !result.some(card => card.move > 0)) throw new Error("ゴールできるよう、各対象に進むカードを1枚以上設定してください。");
    return result;
  }
  function validate(value) {
    const result = Object.fromEntries(["child", "adult"].map(id => [id, validateCards(value?.[id])]));
    const bonus = Object.hasOwn(value, "bonus") ? value.bonus : defaults().bonus;
    result.bonus = Object.fromEntries(["child", "adult"].map(id => [id, validateCards(bonus?.[id], true)]));
    return result;
  }
  function load(storage) {
    const raw = storage.getItem(key);
    return raw === null ? defaults() : validate(JSON.parse(raw));
  }
  function save(storage, value) {
    const clean = validate(value);
    storage.setItem(key, JSON.stringify(clean));
    return clean;
  }
  function game(id, storage) {
    const base = audienceGame(id);
    const value = load(storage);
    return { config: base.config, cards: value[id].map(card => ({ ...card, era: id })) };
  }
  async function sharedRequest(method = "GET", value) {
    const response = await fetch("/api/card-settings", { method, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(value ? { body: JSON.stringify(validate(value)) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Shared card settings request failed.");
    return validate(data.settings);
  }
  const loadShared = () => sharedRequest();
  const saveShared = value => sharedRequest("PUT", value);
  async function sharedGame(id) {
    const value = await loadShared();
    return { config: audienceGame(id).config, cards: value[id].map(card => ({ ...card, era: id })) };
  }
  return { loadShared, saveShared, sharedGame, key, defaults, validateCards, validate, load, save, game };
})();
if (typeof module !== "undefined" && module.exports) module.exports = CardSettings;
