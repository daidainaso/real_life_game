"use strict";

// カードやルールを変更する際は version も更新してください。
const gameConfig = {
  version: 3,
  initialMoney: 100000,
  goal: 50,
  eras: [
    { id: "student", label: "学生", startAt: 0 },
    { id: "adult", label: "社会人", startAt: 10 },
    { id: "senior", label: "老後", startAt: 30 },
  ],
};
const cards = [
  { id: "work", era: "student", title: "アルバイトを頑張った", money: 10000, move: 3, icon: "☕" },
  { id: "books", era: "student", title: "教科書を買った", money: -5000, move: 2, icon: "📚" },
  { id: "scholarship", era: "student", title: "奨学金をもらった", money: 20000, move: 4, icon: "🎓" },
  { id: "club", era: "student", title: "部活動の大会に出た", money: -3000, move: 3, icon: "🏅" },
  { id: "forgot", era: "student", title: "忘れ物を取りに戻った", money: 0, move: -2, icon: "🎒" },
  { id: "school-trip", era: "student", title: "修学旅行に行った", money: -10000, move: 2, icon: "🚌" },
  { id: "travel", era: "adult", title: "旅行に行った", money: -20000, move: 3, icon: "✈" },
  { id: "salary", era: "adult", title: "給料が入った", money: 30000, move: 2, icon: "💼" },
  { id: "wallet", era: "adult", title: "財布を落とした", money: -5000, move: -1, icon: "👛" },
  { id: "phone", era: "adult", title: "スマートフォンを壊した", money: -30000, move: 1, icon: "📱" },
  { id: "marriage", era: "adult", title: "結婚のお祝いをもらった", money: 20000, move: 5, icon: "💐" },
  { id: "bonus", era: "adult", title: "ボーナスをもらった", money: 40000, move: 4, icon: "✨" },
  { id: "pension", era: "senior", title: "年金を受け取った", money: 20000, move: 2, icon: "🏦" },
  { id: "hot-spring", era: "senior", title: "温泉旅行に行った", money: -15000, move: 3, icon: "♨" },
  { id: "gift", era: "senior", title: "孫にお小遣いを渡した", money: -5000, move: 2, icon: "🎁" },
  { id: "lottery", era: "senior", title: "宝くじに当たった", money: 50000, move: 4, icon: "🎉" },
  { id: "checkup", era: "senior", title: "健康診断を受けた", money: -5000, move: 1, icon: "🩺" },
];
