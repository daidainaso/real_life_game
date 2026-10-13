"use strict";

// カードやルールを変更する際は version も更新してください。
const gameConfig = {
  version: 4,
  initialMoney: 100000,
  goal: 50,
};
const adultCards = [
  { id: "travel", title: "旅行に行った", money: -20000, move: 3, icon: "✈" },
  { id: "salary", title: "給料が入った", money: 30000, move: 2, icon: "💼" },
  { id: "wallet", title: "財布を落とした", money: -5000, move: -1, icon: "👛" },
  { id: "phone", title: "スマートフォンを壊した", money: -30000, move: 1, icon: "📱" },
  { id: "marriage", title: "結婚のお祝いをもらった", money: 20000, move: 5, icon: "💐" },
  { id: "bonus", title: "ボーナスをもらった", money: 40000, move: 4, icon: "✨" },
  { id: "pension", title: "年金を受け取った", money: 20000, move: 2, icon: "🏦" },
  { id: "hot-spring", title: "温泉旅行に行った", money: -15000, move: 3, icon: "♨" },
  { id: "gift", title: "孫にお小遣いを渡した", money: -5000, move: 2, icon: "🎁" },
  { id: "lottery", title: "宝くじに当たった", money: 50000, move: 4, icon: "🎉" },
  { id: "checkup", title: "健康診断を受けた", money: -5000, move: 1, icon: "🩺" },
];

// 子ども用と大人用は別の山札です。追加カードもこちらへ登録します。
const audiences = {
  child: { label: "子供", cards: [
    { id: "child-help", title: "お手伝いをしてお小遣いをもらった", money: 1000, move: 3, icon: "🧹" },
    { id: "child-books", title: "好きな本を買った", money: -500, move: 2, icon: "📚" },
    { id: "child-gift", title: "お年玉をもらった", money: 3000, move: 4, icon: "🎁" },
    { id: "child-club", title: "運動会で頑張った", money: 0, move: 3, icon: "🏅" },
    { id: "child-forgot", title: "忘れ物を取りに戻った", money: 0, move: -2, icon: "🎒" },
    { id: "child-snack", title: "おやつを買った", money: -300, move: 2, icon: "🍪" },
  ] },
  adult: { label: "大人", cards: adultCards },
};
function audienceGame(id) {
  if (!Object.hasOwn(audiences, id)) throw new Error("対象を選んでください。");
  return {
    config: { ...gameConfig, version: 4, eras: [{ id, label: audiences[id].label, startAt: 0 }] },
    cards: audiences[id].cards.map(card => ({ ...card, era: id })),
  };
}
// グループ専用：先にゴールした人が自分の手番に引く山札です。
const bonusCards = {
  child: [
    { id: "goal-child-help", title: "ゴール後のお手伝いでお小遣いをもらった", money: 500, move: 0, icon: "🧹" },
    { id: "goal-child-prize", title: "頑張ったごほうびをもらった", money: 1000, move: 0, icon: "🏅" },
    { id: "goal-child-festival", title: "学祭のお店を手伝ってお礼をもらった", money: 1500, move: 0, icon: "🎪" },
    { id: "goal-child-gift", title: "ゴールのお祝いをもらった", money: 2000, move: 0, icon: "🎁" },
  ],
  adult: [
    { id: "goal-adult-help", title: "地域のお手伝いで謝礼をもらった", money: 5000, move: 0, icon: "🤝" },
    { id: "goal-adult-work", title: "短期の仕事で報酬をもらった", money: 10000, move: 0, icon: "💼" },
    { id: "goal-adult-prize", title: "これまでの活躍が表彰された", money: 15000, move: 0, icon: "🏅" },
    { id: "goal-adult-gift", title: "ゴールのお祝い金をもらった", money: 20000, move: 0, icon: "🎁" },
  ],
};
if (typeof module !== "undefined" && module.exports) module.exports = { audienceGame, bonusCards };
