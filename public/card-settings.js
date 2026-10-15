"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let draft;
  let audience = "child";
  let kind = "normal";
  const currentCards = () => kind === "bonus" ? draft.bonus[audience] : draft[audience];
  let dirty = false;
  function message(text) { $("settings-message").textContent = text; $("settings-message").hidden = false; }
  try { draft = CardSettings.load(localStorage); }
  catch { draft = CardSettings.defaults(); message("保存した設定を読み込めませんでした。初期設定を表示しています。保存をやり直してください。"); }
  function changed() { dirty = true; $("save-status").textContent = "未保存の変更があります"; }
  function render() {
    $("settings-cards").replaceChildren();
    $("card-count").textContent = `${currentCards().length}枚`;
    $("bonus-hint").hidden = kind !== "bonus";
    for (const button of document.querySelectorAll("[data-kind]")) button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
    for (const button of document.querySelectorAll("[data-audience]")) button.setAttribute("aria-pressed", String(button.dataset.audience === audience));
    currentCards().forEach((card, index) => {
      const row = document.createElement("li");
      const summary = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = `${card.icon} ${card.title}`;
      const detail = document.createElement("p"); detail.textContent = `${card.money.toLocaleString('ja-JP')}円 · ${card.move}マス`;
      summary.append(title, detail);
      const actions = document.createElement("div"); actions.className = "settings-item-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "settings-small-button"; edit.textContent = "編集";
      edit.setAttribute("aria-label", `${card.title}を編集`);
      edit.addEventListener("click", () => openEditor(index, edit));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "削除";
      remove.setAttribute("aria-label", `${card.title}を削除`); remove.disabled = currentCards().length === 1;
      remove.addEventListener("click", () => { currentCards().splice(index, 1); changed(); render(); $("add-card").focus(); });
      actions.append(edit, remove); row.append(summary, actions); $("settings-cards").append(row);
    });
    for (const id of ["add-card", "add-card-bottom"]) $(id).disabled = currentCards().length >= 200;
  }
  document.querySelectorAll("[data-audience]").forEach(button => button.addEventListener("click", () => { audience = button.dataset.audience; render(); }));
  document.querySelectorAll("[data-kind]").forEach(button => button.addEventListener("click", () => { kind = button.dataset.kind; render(); }));
  let editingIndex = null, editorTrigger;
  function openEditor(index, trigger) {
    editingIndex = index; editorTrigger = trigger;
    const card = index === null ? { icon: "✦", title: "", money: 0, move: kind === "bonus" ? 0 : 1 } : currentCards()[index];
    for (const key of ["icon", "title", "money", "move"]) $("edit-" + key).value = card[key];
    $("edit-move").readOnly = kind === "bonus";
    $("card-editor-heading").textContent = index === null ? "カードを追加" : "カードを編集";
    $("card-editor-error").hidden = true;
    $("card-editor").showModal(); $("edit-title").focus();
  }
  $("cancel-card").addEventListener("click", () => $("card-editor").close());
  $("card-editor").addEventListener("close", () => { (editorTrigger?.isConnected ? editorTrigger : $("add-card")).focus(); });
  $("card-editor-form").addEventListener("submit", event => {
    event.preventDefault();
    const card = { id: editingIndex === null ? `${audience}-${crypto.randomUUID()}` : currentCards()[editingIndex].id };
    for (const key of ["icon", "title", "money", "move"]) card[key] = ["money", "move"].includes(key) ? $("edit-" + key).valueAsNumber : $("edit-" + key).value;
    if (kind === "bonus") card.move = 0;
    const candidate = structuredClone(draft), list = kind === "bonus" ? candidate.bonus[audience] : candidate[audience];
    if (editingIndex === null) list.push(card); else list[editingIndex] = card;
    try {
      draft = CardSettings.save(localStorage, candidate); dirty = false; render();
      $("save-status").textContent = "保存済みの設定";
      $("card-editor").close(); message("カードを保存しました。次のゲームから反映されます。");
    } catch (error) { $("card-editor-error").textContent = error.message; $("card-editor-error").hidden = false; }
  });
  for (const id of ["add-card", "add-card-bottom"]) $(id).addEventListener("click", () => {
    if (currentCards().length < 200) openEditor(null, $(id));
  });
  $("settings-form").addEventListener("submit", event => {
    event.preventDefault();
    try { draft = CardSettings.save(localStorage, draft); dirty = false; render(); $("save-status").textContent = "保存済みの設定"; message("保存しました。次のゲームから反映されます。"); }
    catch (error) { message(error.name === "QuotaExceededError" || error.name === "SecurityError" ? "ブラウザに保存できません。設定をJSONで書き出して保管してください。" : error.message); }
  });
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export-json").addEventListener("click", () => { try { download("life-game-cards.json", JSON.stringify(CardSettings.validate(draft), null, 2), "application/json"); message("編集中の設定をJSONで書き出しました。"); } catch (error) { message(error.message); } });
  $("import-json").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error("1MB以下のJSONファイルを選んでください。"); const value = CardSettings.validate(JSON.parse(await file.text())); draft = value; changed(); render(); message("設定を読み込みました。「設定を保存」で反映できます。"); }
    catch (error) { message(error instanceof SyntaxError ? "JSONの形式を確認してください。" : error.message); }
    finally { event.target.value = ""; }
  });
  $("export-source").addEventListener("click", () => {
    try {
      const value = CardSettings.validate(draft);
      const nextConfig = { ...gameConfig, version: Date.now() };
      const source = `"use strict";\nconst gameConfig = ${JSON.stringify(nextConfig, null, 2)};\nconst audiences = ${JSON.stringify({ child: { label: audiences.child.label, cards: value.child }, adult: { label: audiences.adult.label, cards: value.adult } }, null, 2)};\nfunction audienceGame(id) {\n  if (!Object.hasOwn(audiences, id)) throw new Error("対象を選んでください。");\n  return { config: { ...gameConfig, eras: [{ id, label: audiences[id].label, startAt: 0 }] }, cards: audiences[id].cards.map(card => ({ ...card, era: id })) };\n}\nconst bonusCards = ${JSON.stringify(value.bonus, null, 2)};\nif (typeof module !== "undefined" && module.exports) module.exports = { audienceGame, bonusCards };\n`;
      download("cards.js", source, "text/javascript"); message("cards.jsを出力しました。アプリ全体の初期設定を変更する場合は、public/cards.jsに置き換えて再デプロイしてください。");
    } catch (error) { message(error.message); }
  });
  $("reset-cards").addEventListener("click", () => { $("settings-confirm").returnValue = "cancel"; $("settings-confirm").showModal(); });
  $("settings-confirm").addEventListener("close", () => { if ($("settings-confirm").returnValue === "ok") { const initial = CardSettings.defaults(); if (kind === "bonus") draft.bonus[audience] = initial.bonus[audience]; else draft[audience] = initial[audience]; changed(); render(); message("選択中のカードを初期設定に戻しました。保存すると反映されます。"); } });
  window.addEventListener("beforeunload", event => { if (dirty || $("card-editor").open) { event.preventDefault(); event.returnValue = ""; } });
  render();
})();
