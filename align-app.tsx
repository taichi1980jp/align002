/**
 * ALIGN SCORE
 * "本来の資質"と"いまの自分"の差分を可視化する診断サービス
 *
 * Original creation by Ishiguro Taichi
 * © Ishiguro Taichi. All rights reserved.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
} from "recharts";
import {
  Sparkles, Brain, Zap, Heart, Anchor, Palette, Flag, Wind,
  ArrowRight, ArrowLeft, Share2, Download, Sun, Moon,
} from "lucide-react";

/* =========================================================================
   fortune-engine (mock)
   本番では四柱推命APIから命式(年柱/月柱/日柱/時柱・五行バランス)を取得し、
   ここで「本来持っている資質」8軸スコアを算出する。
   現状は生年月日から決定論的な擬似乱数を生成し代替している。
   API接続時は calcInnateTraits の中身だけを差し替えればよい設計。
   ========================================================================= */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
function calcInnateTraits(birthDate, birthTime) {
  const seed = hashSeed(`${birthDate}_${birthTime || "00:00"}`);
  const result = {};
  TRAITS.forEach((t, i) => {
    const r = seededRandom(seed + i * 97.13);
    result[t.key] = Math.round(28 + r * 68); // 28-96
  });
  return result;
}

/* =========================================================================
   diagnosis-engine
   24問の回答から「現在発揮している能力」を算出し、本来の資質との差分・
   運命一致度・タイプを決定する。
   ========================================================================= */
function calcCurrentTraits(answers) {
  const result = {};
  TRAITS.forEach((t) => {
    const qs = QUESTIONS.filter((q) => q.trait === t.key);
    const scores = qs.map((q) => answers[q.id]).filter((v) => v != null);
    if (scores.length === 0) {
      result[t.key] = 50;
      return;
    }
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length; // 1-4
    result[t.key] = Math.round(((avg - 1) / 3) * 100);
  });
  return result;
}
function calcAlignment(innate, current) {
  const diffs = TRAITS.map((t) => Math.abs(innate[t.key] - current[t.key]));
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.max(0, Math.min(100, Math.round(100 - avgDiff)));
}
function topTrait(scores) {
  return TRAITS.reduce((best, t) =>
    scores[t.key] > scores[best.key] ? t : best, TRAITS[0]).key;
}
function dormantTrait(innate, current) {
  let best = TRAITS[0].key;
  let bestGap = -Infinity;
  TRAITS.forEach((t) => {
    const gap = innate[t.key] - current[t.key];
    if (gap > bestGap) {
      bestGap = gap;
      best = t.key;
    }
  });
  return best;
}
function determineType(innateTop) {
  return TYPE_MAP[innateTop];
}

/* =========================================================================
   prompt (AI生成文の擬似実装)
   本番ではここでLLMにプロフィール・命式・回答傾向を渡し、自然文を生成する。
   現状はテンプレート補間による代替実装。
   ========================================================================= */
function generateStory({ name, innateTopLabel, currentTopLabel, dormantLabel, alignment }) {
  return [
    `${name}さんの命式が示す本来の資質は「${innateTopLabel}」。生まれ持ってこの力がもっとも強く働くようにできています。`,
    `一方で、いまの${name}さんが最も発揮できているのは「${currentTopLabel}」。日々の役割や環境の中で、この力を使う場面が多いのかもしれません。`,
    `特に注目したいのは「${dormantLabel}」です。本来は高い資質を持ちながら、いまはまだ十分に発揮できていません。運命一致度${alignment}%という数字は、"本来のあなた"と"いまのあなた"の距離をそのまま表しています。`,
    `この差は、欠点ではありません。まだ開かれていない扉です。`,
  ];
}
function generateAiMessage({ name, dormantLabel }) {
  return `${name}さんへ。「${dormantLabel}」は、まだ誰にも見せていないだけで、確かにあなたの中にあります。次の30日は、それを少しだけ外に出す練習期間です。`;
}

/* ========================= データ定義 ========================= */
const TRAITS = [
  { key: "intuition", label: "直感力", icon: Sparkles, color: "#9C8CFF" },
  { key: "logic", label: "論理力", icon: Brain, color: "#4FD9E8" },
  { key: "drive", label: "行動力", icon: Zap, color: "#F0A868" },
  { key: "empathy", label: "共感力", icon: Heart, color: "#F5789C" },
  { key: "persistence", label: "継続力", icon: Anchor, color: "#5FBF8F" },
  { key: "creativity", label: "創造力", icon: Palette, color: "#C77DE0" },
  { key: "leadership", label: "統率力", icon: Flag, color: "#E8C77A" },
  { key: "adaptability", label: "適応力", icon: Wind, color: "#7FD4D9" },
];
const TRAIT_LABEL = Object.fromEntries(TRAITS.map((t) => [t.key, t.label]));

/* =========================================================================
   share-image (スコア→色変換 + シェア画像生成)
   8能力のスコアを、各TRAITに既に定義されている色(TRAITS[].color)の色相を
   ベースにしたグラデーションへ変換する。「いまの自分」の状態をそのまま
   一意なビジュアルにして、単独シェア画像の背景に使う。
   ========================================================================= */
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return h;
}
const TRAIT_HUES = Object.fromEntries(TRAITS.map((t) => [t.key, hexToHue(t.color)]));

function scoreToSL(score) {
  const c = Math.max(0, Math.min(100, score));
  return { s: 30 + (c / 100) * 60, l: 35 + (c / 100) * 25 };
}
function scoresToColorStops(scores) {
  return TRAITS.map((t) => {
    const score = scores?.[t.key] ?? 0;
    const hue = TRAIT_HUES[t.key];
    const { s, l } = scoreToSL(score);
    return { key: t.key, label: t.label, score, hue, s, l, hsl: `hsl(${hue.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)` };
  });
}
function generateGradient(scores, topN = 3, angle = 135) {
  const sorted = scoresToColorStops(scores).sort((a, b) => b.score - a.score).slice(0, topN);
  const stops = sorted.map((c, i) => `${c.hsl} ${(sorted.length === 1 ? 50 : (i / (sorted.length - 1)) * 100).toFixed(0)}%`);
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}
function generateGlow(scores) {
  const top2 = scoresToColorStops(scores).sort((a, b) => b.score - a.score).slice(0, 2);
  return top2.map((c, i) =>
    `radial-gradient(circle at ${i === 0 ? "20% 20%" : "80% 80%"}, hsla(${c.hue.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%, 0.55) 0%, transparent 60%)`
  ).join(", ");
}
const HUE_COLOR_NAMES = [
  { max: 15, name: "ルビー" }, { max: 50, name: "アンバー" },
  { max: 80, name: "ライム" }, { max: 150, name: "エメラルド" },
  { max: 200, name: "アクア" }, { max: 250, name: "サファイア" },
  { max: 290, name: "アメジスト" }, { max: 340, name: "ローズ" },
  { max: 361, name: "ルビー" },
];
function hueToColorName(hue) {
  return (HUE_COLOR_NAMES.find((e) => hue <= e.max) || {}).name || "ルビー";
}
function generateColorTypeName(scores) {
  const top2 = scoresToColorStops(scores).sort((a, b) => b.score - a.score).slice(0, 2);
  if (top2.length < 2) return `${hueToColorName(top2[0]?.hue ?? 0)}型`;
  return `${hueToColorName(top2[0].hue)}×${hueToColorName(top2[1].hue)}型`;
}

/**
 * 1200x630のシェア画像をCanvasで生成し、PNGのdata URLを返す。
 * サーバーを使わずクライアント側だけで完結する(将来@vercel/ogに置き換え可能)。
 */
function renderShareImageDataUrl({ scores, alignment, colorTypeName }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");

  const stops = scoresToColorStops(scores).sort((a, b) => b.score - a.score).slice(0, 3);

  // 背景グラデーション(135度相当: 左上→右下)
  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  stops.forEach((c, i) => {
    const pos = stops.length === 1 ? 0.5 : i / (stops.length - 1);
    grad.addColorStop(pos, c.hsl);
  });
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  // 上位2色のグロー
  stops.slice(0, 2).forEach((c, i) => {
    const cx = i === 0 ? 1200 * 0.2 : 1200 * 0.8;
    const cy = i === 0 ? 630 * 0.2 : 630 * 0.8;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
    rg.addColorStop(0, `hsla(${c.hue.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%, 0.55)`);
    rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 1200, 630);
  });

  // 可読性のためのビネット(上下を軽く暗く)
  const vTop = ctx.createLinearGradient(0, 630, 0, 630 * 0.7);
  vTop.addColorStop(0, "rgba(0,0,0,0.35)");
  vTop.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vTop;
  ctx.fillRect(0, 630 * 0.7, 1200, 630 * 0.3);

  const vBottom = ctx.createLinearGradient(0, 0, 0, 630 * 0.25);
  vBottom.addColorStop(0, "rgba(0,0,0,0.25)");
  vBottom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vBottom;
  ctx.fillRect(0, 0, 1200, 630 * 0.25);

  // ラベル
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "700 22px 'Zen Kaku Gothic New', sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("A L I G N   S C O R E", 66, 58);

  // スコア(左下・大きく)
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 200px 'Zen Kaku Gothic New', sans-serif";
  const scoreText = String(alignment);
  ctx.fillText(scoreText, 66, 500);
  const scoreWidth = ctx.measureText(scoreText).width;
  ctx.font = "700 64px 'Zen Kaku Gothic New', sans-serif";
  ctx.fillText("%", 66 + scoreWidth + 10, 500);

  // 色タイプ名(右下)
  ctx.font = "700 32px 'Zen Kaku Gothic New', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(colorTypeName, 1134, 500);
  ctx.textAlign = "left";

  // フッター
  ctx.shadowBlur = 0;
  ctx.font = "400 20px 'Zen Kaku Gothic New', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("ALIGN SCORE 診断", 66, 572);

  return canvas.toDataURL("image/png");
}

const TYPE_MAP = {
  intuition: "Explorer",
  logic: "Strategist",
  drive: "Builder",
  empathy: "Connector",
  persistence: "Guardian",
  creativity: "Visionary",
  leadership: "Leader",
  adaptability: "Voyager",
};

const TYPE_CONTENT = {
  Explorer: {
    label: "探索者",
    oneLiner: "答えが出る前に、もう次の扉を開けている。",
    lifeTheme: "未知を切り拓き、誰も見ていない可能性を最初に見つけること",
    thrivingEnv: "裁量が大きく、正解のない問いに向き合える環境",
    strugglingEnv: "決められた手順を寸分違わず守ることを求められる環境",
    jobs: ["新規事業開発", "プロダクトマネージャー", "起業家"],
    trap: "面白そうだと感じた瞬間に飛びつき、検証を後回しにしてしまう",
  },
  Strategist: {
    label: "戦略家",
    oneLiner: "感情ではなく、構造で世界を読み解く。",
    lifeTheme: "複雑な物事を整理し、勝ち筋を設計すること",
    thrivingEnv: "論理的な議論が歓迎され、意思決定に根拠が求められる環境",
    strugglingEnv: "空気や勢いで物事が決まっていく環境",
    jobs: ["経営企画", "コンサルタント", "アナリスト"],
    trap: "正しさにこだわりすぎて、決断のタイミングを逃す",
  },
  Builder: {
    label: "構築者",
    oneLiner: "考えるより先に、もう手が動いている。",
    lifeTheme: "アイデアを形にし、着実に積み上げていくこと",
    thrivingEnv: "スピード感があり、実行力がそのまま評価される環境",
    strugglingEnv: "議論ばかりで実行に移らない環境",
    jobs: ["セールス", "エンジニア", "現場マネージャー"],
    trap: "とりあえず動いてしまい、準備不足のまま突き進む",
  },
  Connector: {
    label: "橋渡し役",
    oneLiner: "誰かの言葉にならない気持ちに、一番に気づく。",
    lifeTheme: "人と人の間をつなぎ、チームの温度を上げること",
    thrivingEnv: "対話と信頼関係が重視されるチーム",
    strugglingEnv: "成果だけが数字で評価され、人間関係が軽視される環境",
    jobs: ["人事", "カウンセラー", "チームリーダー"],
    trap: "相手に合わせすぎて、自分の意見を後回しにしてしまう",
  },
  Guardian: {
    label: "守護者",
    oneLiner: "誰も見ていなくても、同じ熱量で積み上げ続ける。",
    lifeTheme: "長期的な信頼と積み重ねによって成果を出すこと",
    thrivingEnv: "腰を据えて取り組める、変化の少ない環境",
    strugglingEnv: "方針が頻繁に変わり、短期成果ばかり求められる環境",
    jobs: ["経理・財務", "品質管理", "研究職"],
    trap: "変化を避けすぎて、必要なタイミングでの方向転換に遅れる",
  },
  Visionary: {
    label: "先見者",
    oneLiner: "誰も見たことのない景色を、先に思い描いている。",
    lifeTheme: "既存の枠を超えた新しい価値を生み出すこと",
    thrivingEnv: "自由な発想が歓迎され、実験が許される環境",
    strugglingEnv: "前例踏襲が絶対とされる環境",
    jobs: ["クリエイティブディレクター", "企画職", "デザイナー"],
    trap: "アイデアを広げすぎて、一つに絞り込めなくなる",
  },
  Leader: {
    label: "統率者",
    oneLiner: "気づけば、いつも人の輪の中心にいる。",
    lifeTheme: "人を導き、目標に向かって周囲を動かすこと",
    thrivingEnv: "裁量権を持ち、意思決定を任される環境",
    strugglingEnv: "誰も決断せず、責任の所在があいまいな環境",
    jobs: ["マネージャー", "経営者", "プロジェクトリーダー"],
    trap: "自分で決めすぎて、周囲の意見を吸い上げる前に進めてしまう",
  },
  Voyager: {
    label: "旅人",
    oneLiner: "変化そのものを、自分の居場所にできる。",
    lifeTheme: "環境や役割が変わっても、しなやかに価値を出し続けること",
    thrivingEnv: "変化のスピードが速く、多様な役割を求められる環境",
    strugglingEnv: "一つのやり方を長期間変えられない環境",
    jobs: ["フリーランス", "事業横断ポジション", "複業ワーカー"],
    trap: "器用に合わせすぎて、自分の軸を見失う",
  },
};

const QUESTIONS = [
  { id: "q1", trait: "intuition", text: "新しい判断を迫られたとき、あなたが最初に頼るのは？", options: ["データを集め切るまで動かない", "なんとなく違和感があれば立ち止まる", "直感で方向性を決め、あとから理由を整理する", "一瞬で「これだ」と確信し即断する"] },
  { id: "q2", trait: "intuition", text: "会議で誰も気づいていない違和感に気づいたとき", options: ["気のせいだと流す", "メモしておき後で確認する", "その場で軽く指摘してみる", "迷わず発言し議論の流れを変える"] },
  { id: "q3", trait: "intuition", text: "初対面の人と話すとき", options: ["相手のプロフィールを事前に調べておく", "話しながら少しずつ距離を測る", "第一印象でおおよその人物像が掴める", "数秒で「合う/合わない」がわかる"] },
  { id: "q4", trait: "logic", text: "問題が起きたとき、まず行うのは？", options: ["感覚で対処法を選ぶ", "周囲に相談する", "原因を洗い出し要因を整理する", "構造化して根本原因を特定するまで動かない"] },
  { id: "q5", trait: "logic", text: "資料を作るとき、いちばん重視するのは？", options: ["見た目の印象", "伝えたい熱量", "わかりやすい構成", "論理の一貫性とエビデンス"] },
  { id: "q6", trait: "logic", text: "意見が対立したとき", options: ["感情的に譲る", "雰囲気で丸く収める", "根拠を出し合って議論する", "前提から検証し矛盾を突き詰める"] },
  { id: "q7", trait: "drive", text: "やりたいことを見つけたら", options: ["誰かの後押しを待つ", "計画を練ってから動く", "走りながら考える", "その日のうちに動き出す"] },
  { id: "q8", trait: "drive", text: "新しいプロジェクトの機会が来たら", options: ["様子を見る", "条件が整えば手を挙げる", "多少不安でも挑戦する", "真っ先に手を挙げる"] },
  { id: "q9", trait: "drive", text: "大きく失敗したあと", options: ["しばらく動けなくなる", "振り返りに時間をかける", "切り替えて次に進む", "すぐに次の挑戦を探す"] },
  { id: "q10", trait: "empathy", text: "同僚が落ち込んでいたら", options: ["気づかないことが多い", "気づくが声はかけない", "さりげなく気にかける", "すぐに話を聞きに行く"] },
  { id: "q11", trait: "empathy", text: "チームで意思決定するとき", options: ["自分の意見を最優先する", "効率を優先する", "多数派に合わせる", "一人ひとりの気持ちを汲み取る"] },
  { id: "q12", trait: "empathy", text: "相手の話を聞くとき", options: ["結論だけ知りたい", "要点を整理しながら聞く", "表情や声のトーンも見る", "言葉にならない感情まで読み取ろうとする"] },
  { id: "q13", trait: "persistence", text: "地道な作業が続くとき", options: ["すぐ飽きる", "気分転換しながら続ける", "淡々とこなせる", "むしろ集中力が増す"] },
  { id: "q14", trait: "persistence", text: "目標達成までの期間が長いとき", options: ["途中で諦めがち", "モチベーションの波がある", "多少停滞しても続けられる", "何年でも同じ熱量で続けられる"] },
  { id: "q15", trait: "persistence", text: "習慣化しようとしたことは？", options: ["三日坊主になりやすい", "波はあるが戻ってくる", "だいたい定着する", "一度決めたらほぼ確実に続く"] },
  { id: "q16", trait: "creativity", text: "資料やアイデアを考えるとき", options: ["前例に沿って作る", "前例を少しアレンジする", "新しい切り口を加える", "ゼロから独自の発想を作る"] },
  { id: "q17", trait: "creativity", text: "制約が多い状況では", options: ["動けなくなる", "最低限の工夫で対応する", "制約の中で工夫を楽しめる", "制約が逆に発想の源になる"] },
  { id: "q18", trait: "creativity", text: "周囲からよく言われることは？", options: ["堅実", "丁寧", "発想がユニーク", "突拍子もない"] },
  { id: "q19", trait: "leadership", text: "チームが停滞しているとき", options: ["誰かが動くのを待つ", "意見を求められれば答える", "自分から方向性を提案する", "自然と場を仕切っている"] },
  { id: "q20", trait: "leadership", text: "責任のある役割を任されたら", options: ["不安が先に立つ", "慎重に引き受ける", "前向きに引き受ける", "むしろやる気に火がつく"] },
  { id: "q21", trait: "leadership", text: "チームの意見がバラバラなとき", options: ["静観する", "個別に話を聞く", "落としどころを提案する", "自分の判断で決めて進める"] },
  { id: "q22", trait: "adaptability", text: "急な予定変更があったら", options: ["強いストレスを感じる", "少し戸惑うが対応する", "すぐに切り替えられる", "むしろ変化を楽しめる"] },
  { id: "q23", trait: "adaptability", text: "新しい環境に入るとき", options: ["慣れるまで時間がかかる", "観察してから馴染む", "比較的早く馴染む", "初日から自分の場所にできる"] },
  { id: "q24", trait: "adaptability", text: "ルールや前提が変わったとき", options: ["混乱しやすい", "一度整理してから動く", "柔軟に対応できる", "変化ごと楽しんで動ける"] },
];

const ANALYZE_STEPS = ["プロフィールを解析しています", "資質を抽出しています", "行動パターンを分析しています", "差分を計算しています"];

/* ========================= UI: 共通パーツ ========================= */
function AuroraBackground() {
  return (
    <div className="align-aurora" aria-hidden="true">
      <div className="align-blob b1" />
      <div className="align-blob b2" />
      <div className="align-blob b3" />
      <div className="align-noise" />
    </div>
  );
}

function ProgressBar({ current, total }) {
  const pct = (current / total) * 100;
  return (
    <div className="align-progress-track" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={total}>
      <div className="align-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function DestinyGauge({ percent }) {
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setFilled(percent), 150);
    return () => clearTimeout(t);
  }, [percent]);
  const r = 92;
  const c = 2 * Math.PI * r;
  const offset = c - (filled / 100) * c;
  return (
    <div className="align-gauge">
      <svg viewBox="0 0 220 220" className="align-gauge-svg">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E8C77A" />
            <stop offset="100%" stopColor="#F0A868" />
          </linearGradient>
        </defs>
        {Array.from({ length: 60 }).map((_, i) => {
          const angle = (i / 60) * 360;
          const major = i % 5 === 0;
          return (
            <line key={i} x1="110" y1="8" x2="110" y2={major ? "20" : "15"}
              stroke={major ? "rgba(245,244,247,0.35)" : "rgba(245,244,247,0.15)"}
              strokeWidth={major ? 2 : 1}
              transform={`rotate(${angle} 110 110)`} />
          );
        })}
        <circle cx="110" cy="110" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
        <circle cx="110" cy="110" r={r} fill="none" stroke="url(#goldGrad)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 110 110)"
          style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.16,1,.3,1)" }} />
      </svg>
      <div className="align-gauge-center">
        <div className="align-gauge-percent">{filled}<span>%</span></div>
        <div className="align-gauge-label">ALIGN SCORE</div>
      </div>
    </div>
  );
}

function TraitRadar({ innate, current }) {
  const data = TRAITS.map((t) => ({
    trait: t.label,
    本来: innate[t.key],
    現在: current[t.key],
  }));
  return (
    <ResponsiveContainer width="100%" height={340}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="rgba(245,244,247,0.12)" />
        <PolarAngleAxis dataKey="trait" tick={{ fill: "#B9B8C6", fontSize: 12, fontFamily: "'Zen Kaku Gothic New', sans-serif" }} />
        <Radar name="本来" dataKey="本来" stroke="#E8C77A" fill="#E8C77A" fillOpacity={0.16} strokeWidth={2} />
        <Radar name="現在" dataKey="現在" stroke="#7FD4D9" fill="#7FD4D9" fillOpacity={0.16} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/* ========================= メインアプリ ========================= */
export default function AlignApp() {
  const [stage, setStage] = useState("opening"); // opening -> profile -> questions -> analyzing -> result
  const [profile, setProfile] = useState({ nickname: "", birthDate: "", birthTime: "", unknownTime: false, gender: "" });
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [toast, setToast] = useState("");

  const innate = useMemo(
    () => (profile.birthDate ? calcInnateTraits(profile.birthDate, profile.birthTime) : null),
    [profile.birthDate, profile.birthTime]
  );
  const current = useMemo(() => calcCurrentTraits(answers), [answers]);
  const alignment = useMemo(() => (innate ? calcAlignment(innate, current) : 0), [innate, current]);
  const innateTop = useMemo(() => (innate ? topTrait(innate) : null), [innate]);
  const currentTop = useMemo(() => topTrait(current), [current]);
  const dormant = useMemo(() => (innate ? dormantTrait(innate, current) : null), [innate, current]);
  const type = innateTop ? determineType(innateTop) : null;
  const typeContent = type ? TYPE_CONTENT[type] : null;

  // シェア画像用:「いまの自分」の状態(current)を色に変換
  const colorTypeName = useMemo(() => generateColorTypeName(current), [current]);
  const posterBackground = useMemo(
    () => `${generateGlow(current)}, ${generateGradient(current)}`,
    [current]
  );

  useEffect(() => {
    console.log(
      "%cALIGN SCORE %c— Original creation by Ishiguro Taichi",
      "color:#E8C77A; font-weight:700;",
      "color:#888; font-weight:400;"
    );
  }, []);

  useEffect(() => {
    if (stage !== "analyzing") return;
    setAnalyzeStep(0);
    const timers = ANALYZE_STEPS.map((_, i) =>
      setTimeout(() => setAnalyzeStep(i + 1), 700 * (i + 1))
    );
    const done = setTimeout(() => setStage("result"), 700 * ANALYZE_STEPS.length + 500);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [stage]);

  function selectAnswer(qId, scoreIndex) {
    setAnswers((prev) => ({ ...prev, [qId]: scoreIndex + 1 }));
    setTimeout(() => {
      if (qIndex < QUESTIONS.length - 1) {
        setQIndex((i) => i + 1);
      } else {
        setStage("analyzing");
      }
    }, 260);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  const story = typeContent
    ? generateStory({
        name: profile.nickname || "あなた",
        innateTopLabel: TRAIT_LABEL[innateTop],
        currentTopLabel: TRAIT_LABEL[currentTop],
        dormantLabel: TRAIT_LABEL[dormant],
        alignment,
      })
    : [];
  const aiMessage = typeContent
    ? generateAiMessage({ name: profile.nickname || "あなた", dormantLabel: TRAIT_LABEL[dormant] })
    : "";

  return (
    <div className="align-root">
      <style>{CSS}</style>
      <AuroraBackground />

      {stage === "opening" && (
        <section className="align-screen align-center fade-in">
          <div className="align-eyebrow">ALIGN SCORE</div>
          <h1 className="align-hero-title">
            あなたは本来の自分を
            <br />
            <span className="align-hero-number">何%</span>生きていますか？
          </h1>
          <p className="align-hero-sub">
            "本来の資質"と"いまの自分"の差分を可視化する診断です。
          </p>
          <button className="align-btn-primary" onClick={() => setStage("profile")}>
            診断をはじめる <ArrowRight size={18} />
          </button>
          <div className="align-meta-row">
            <span>所要時間 約3分</span>
            <span className="align-dot">・</span>
            <span>全24問</span>
          </div>
        </section>
      )}

      {stage === "profile" && (
        <section className="align-screen align-center fade-in">
          <div className="align-eyebrow">STEP 1 — プロフィール</div>
          <h2 className="align-section-title">命式を読み解くための、
            <br />いくつかの情報を教えてください</h2>

          <div className="align-form">
            <label className="align-field">
              <span>ニックネーム</span>
              <input
                type="text"
                value={profile.nickname}
                placeholder="例）たいち"
                onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
              />
            </label>
            <label className="align-field">
              <span>生年月日</span>
              <input
                type="date"
                value={profile.birthDate}
                onChange={(e) => setProfile((p) => ({ ...p, birthDate: e.target.value }))}
              />
            </label>
            <label className="align-field">
              <span>出生時間（任意）</span>
              <input
                type="time"
                value={profile.birthTime}
                disabled={profile.unknownTime}
                onChange={(e) => setProfile((p) => ({ ...p, birthTime: e.target.value }))}
              />
              <button
                type="button"
                className="align-inline-toggle"
                onClick={() => setProfile((p) => ({ ...p, unknownTime: !p.unknownTime, birthTime: "" }))}
              >
                {profile.unknownTime ? "☑" : "☐"} 出生時間はわからない
              </button>
            </label>
            <div className="align-field">
              <span>性別（任意）</span>
              <div className="align-chip-row">
                {["男性", "女性", "回答しない"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`align-chip ${profile.gender === g ? "active" : ""}`}
                    onClick={() => setProfile((p) => ({ ...p, gender: g }))}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="align-nav-row">
            <button className="align-btn-ghost" onClick={() => setStage("opening")}>
              <ArrowLeft size={16} /> 戻る
            </button>
            <button
              className="align-btn-primary"
              disabled={!profile.nickname || !profile.birthDate}
              onClick={() => setStage("questions")}
            >
              次へ <ArrowRight size={18} />
            </button>
          </div>
        </section>
      )}

      {stage === "questions" && (
        <section className="align-screen align-center fade-in" key={QUESTIONS[qIndex].id}>
          <ProgressBar current={qIndex + 1} total={QUESTIONS.length} />
          <div className="align-q-count">{qIndex + 1} / {QUESTIONS.length}</div>
          <h2 className="align-q-text">{QUESTIONS[qIndex].text}</h2>
          <div className="align-options">
            {QUESTIONS[qIndex].options.map((opt, i) => (
              <button
                key={i}
                className={`align-option ${answers[QUESTIONS[qIndex].id] === i + 1 ? "selected" : ""}`}
                onClick={() => selectAnswer(QUESTIONS[qIndex].id, i)}
              >
                {opt}
              </button>
            ))}
          </div>
          {qIndex > 0 && (
            <button className="align-btn-ghost align-back-floating" onClick={() => setQIndex((i) => i - 1)}>
              <ArrowLeft size={16} /> 戻る
            </button>
          )}
        </section>
      )}

      {stage === "analyzing" && (
        <section className="align-screen align-center fade-in">
          <div className="align-analyze-ring">
            <div className="align-analyze-spinner" />
            <Sparkles size={28} className="align-analyze-icon" />
          </div>
          <div className="align-analyze-steps">
            {ANALYZE_STEPS.map((s, i) => (
              <div key={s} className={`align-analyze-step ${i < analyzeStep ? "done" : i === analyzeStep ? "active" : ""}`}>
                <span className="align-analyze-dot" />
                {s}
              </div>
            ))}
          </div>
        </section>
      )}

      {stage === "result" && typeContent && (
        <section className="align-screen align-result fade-in">
          <div className="align-result-hero">
            <div className="align-eyebrow">YOUR ALIGN SCORE</div>
            <DestinyGauge percent={alignment} />
            <div className="align-type-name">{type}</div>
            <div className="align-type-label">— {typeContent.label} —</div>
            <p className="align-one-liner">{typeContent.oneLiner}</p>
          </div>

          <div className="align-card">
            <div className="align-card-label">人生テーマ</div>
            <p className="align-card-text">{typeContent.lifeTheme}</p>
          </div>

          <div className="align-two-col">
            <div className="align-card accent-current">
              <div className="align-card-label">いま最も使えている才能</div>
              <div className="align-trait-highlight">{TRAIT_LABEL[currentTop]}</div>
              <div className="align-trait-score">{current[currentTop]}</div>
            </div>
            <div className="align-card accent-dormant">
              <div className="align-card-label">まだ眠っている才能</div>
              <div className="align-trait-highlight">{TRAIT_LABEL[dormant]}</div>
              <div className="align-trait-score">{innate[dormant]}<span className="align-trait-score-sub"> / 本来の資質</span></div>
            </div>
          </div>

          <div className="align-card">
            <div className="align-card-label">本来の資質 vs 現在の状態</div>
            <TraitRadar innate={innate} current={current} />
            <div className="align-legend">
              <span><i className="dot gold" /> 本来の資質</span>
              <span><i className="dot cyan" /> 現在の状態</span>
            </div>
          </div>

          <div className="align-card">
            <div className="align-card-label">あなたの物語</div>
            {story.map((p, i) => (
              <p className="align-story-p" key={i}>{p}</p>
            ))}
          </div>

          <div className="align-two-col">
            <div className="align-card">
              <div className="align-card-label">人生で輝く環境</div>
              <p className="align-card-text">{typeContent.thrivingEnv}</p>
            </div>
            <div className="align-card">
              <div className="align-card-label">苦手な環境</div>
              <p className="align-card-text">{typeContent.strugglingEnv}</p>
            </div>
          </div>

          <div className="align-card">
            <div className="align-card-label">向いている仕事</div>
            <div className="align-chip-row">
              {typeContent.jobs.map((j) => (
                <span className="align-chip static" key={j}>{j}</span>
              ))}
            </div>
          </div>

          <div className="align-card">
            <div className="align-card-label">陥りやすい思考</div>
            <p className="align-card-text">{typeContent.trap}</p>
          </div>

          <div className="align-card">
            <div className="align-card-label">30日チャレンジ — 「{TRAIT_LABEL[dormant]}」を育てる</div>
            <div className="align-challenge">
              <div className="align-challenge-level">
                <div className="align-challenge-num">Lv.1 〈1〜10日目〉</div>
                <p>{TRAIT_LABEL[dormant]}を使う場面を、1日1回だけ意識的に選んでみる</p>
              </div>
              <div className="align-challenge-level">
                <div className="align-challenge-num">Lv.2 〈11〜20日目〉</div>
                <p>選んだ行動を記録し、自分の変化に気づけるようにする</p>
              </div>
              <div className="align-challenge-level">
                <div className="align-challenge-num">Lv.3 〈21〜30日目〉</div>
                <p>{TRAIT_LABEL[dormant]}を発揮した場面を、身近な誰かに見せてみる</p>
              </div>
            </div>
          </div>

          <div className="align-card ai-message">
            <div className="align-card-label">AIメッセージ</div>
            <p className="align-card-text">{aiMessage}</p>
          </div>

          <div className="align-sns-card">
            <div className="align-poster" style={{ background: posterBackground }}>
              <div className="align-poster-label">ALIGN SCORE</div>
              <div className="align-poster-row">
                <div className="align-poster-score">
                  {alignment}<span>%</span>
                </div>
                <div className="align-poster-type">{colorTypeName}</div>
              </div>
              <div className="align-poster-footer">{profile.nickname || "あなた"} ・ {type} — {typeContent.label}</div>
            </div>
          </div>

          <div className="align-share-row">
            <div className="align-btn-with-badge">
              <button
                className="align-btn-ghost"
                onClick={() => {
                  const dataUrl = renderShareImageDataUrl({ scores: current, alignment, colorTypeName });
                  const a = document.createElement("a");
                  a.href = dataUrl;
                  a.download = `align-score-${alignment}.png`;
                  a.click();
                  showToast("シェア画像を保存しました");
                }}
              >
                <Download size={16} /> 画像を保存
              </button>
              <span className="align-badge-dev">開発中</span>
            </div>
            <a
              className="align-btn-primary"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `私のALIGN SCOREは${alignment}%、タイプは「${colorTypeName}」でした。#ALIGNSCORE`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => showToast("先に「画像を保存」で書き出した画像を、投稿画面で添付してください")}
            >
              <Share2 size={16} /> Xでシェア
            </a>
          </div>
          <p className="align-dev-note">※ 画像保存機能は現在開発中です。準備が整い次第ご利用いただけます。</p>

          <button
            className="align-btn-ghost align-restart"
            onClick={() => {
              setStage("opening");
              setQIndex(0);
              setAnswers({});
              setProfile({ nickname: "", birthDate: "", birthTime: "", unknownTime: false, gender: "" });
            }}
          >
            もう一度診断する
          </button>
        </section>
      )}

      {toast && <div className="align-toast">{toast}</div>}
      <div className="align-signature">Original creation by Ishiguro Taichi</div>
    </div>
  );
}

/* ========================= スタイル ========================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Zen+Old+Mincho:wght@400;600&display=swap');

.align-root {
  --bg: #05060a;
  --card: rgba(255,255,255,0.045);
  --card-border: rgba(255,255,255,0.09);
  --text: #f5f4f7;
  --text-dim: #9a9aa8;
  --gold: #e8c77a;
  --gold-2: #f0a868;
  --cyan: #7fd4d9;
  position: relative;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'Zen Kaku Gothic New', sans-serif;
  overflow-x: hidden;
  padding-bottom: 40px;
}
.align-root *, .align-root *:before, .align-root *:after { box-sizing: border-box; }
.align-root button, .align-root input { font-family: inherit; }
.align-root :focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  .align-root * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

.align-aurora { position: absolute; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
.align-blob { position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.35; }
.b1 { width: 420px; height: 420px; background: #7c6ff0; top: -120px; left: -80px; animation: driftA 22s ease-in-out infinite; }
.b2 { width: 380px; height: 380px; background: #3fe0b0; bottom: -100px; right: -60px; animation: driftB 26s ease-in-out infinite; }
.b3 { width: 300px; height: 300px; background: #4fd9e8; top: 40%; left: 60%; animation: driftA 30s ease-in-out infinite reverse; opacity: 0.22; }
@keyframes driftA { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,30px); } }
@keyframes driftB { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-30px,-40px); } }
.align-noise { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.05), transparent 60%); }

.align-screen { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 64px 24px 40px; }
.align-center { display: flex; flex-direction: column; align-items: center; text-align: center; }
.fade-in { animation: fadeInUp 0.6s cubic-bezier(.16,1,.3,1) both; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

.align-eyebrow { font-size: 12px; letter-spacing: 0.22em; color: var(--text-dim); text-transform: uppercase; margin-bottom: 18px; }
.align-hero-title { font-family: 'Zen Old Mincho', serif; font-size: 34px; line-height: 1.5; font-weight: 600; margin: 0 0 20px; }
.align-hero-number { font-size: 52px; background: linear-gradient(120deg, var(--gold), var(--gold-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.align-hero-sub { color: var(--text-dim); line-height: 1.9; font-size: 14px; margin-bottom: 36px; }
.align-meta-row { margin-top: 18px; font-size: 12px; color: var(--text-dim); display: flex; gap: 8px; }
.align-dot { opacity: 0.5; }

.align-btn-primary {
  display: inline-flex; align-items: center; gap: 8px; justify-content: center;
  background: linear-gradient(120deg, var(--gold), var(--gold-2));
  color: #14110a; font-weight: 700; font-size: 14.5px; border: none;
  padding: 15px 30px; border-radius: 999px; cursor: pointer;
  text-decoration: none; transition: transform 0.25s ease, box-shadow 0.25s ease;
  box-shadow: 0 8px 24px rgba(232,199,122,0.18);
}
.align-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(232,199,122,0.28); }
.align-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; transform: none; box-shadow: none; }
.align-btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid var(--card-border); color: var(--text);
  padding: 12px 22px; border-radius: 999px; cursor: pointer; font-size: 13.5px;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.align-btn-ghost:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.2); }

.align-section-title { font-family: 'Zen Old Mincho', serif; font-size: 22px; line-height: 1.7; font-weight: 600; margin-bottom: 34px; }

.align-form { width: 100%; display: flex; flex-direction: column; gap: 18px; text-align: left; margin-bottom: 32px; }
.align-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--text-dim); }
.align-field input {
  background: var(--card); border: 1px solid var(--card-border); border-radius: 12px;
  padding: 13px 14px; color: var(--text); font-size: 15px; backdrop-filter: blur(12px);
}
.align-field input:focus { border-color: var(--gold); }
.align-inline-toggle { align-self: flex-start; background: none; border: none; color: var(--text-dim); font-size: 12.5px; cursor: pointer; padding: 2px 0; }
.align-chip-row { display: flex; gap: 10px; flex-wrap: wrap; }
.align-chip {
  background: var(--card); border: 1px solid var(--card-border); color: var(--text);
  padding: 9px 18px; border-radius: 999px; font-size: 13px; cursor: pointer; transition: all 0.2s ease;
}
.align-chip.static { cursor: default; }
.align-chip.active { border-color: var(--gold); background: rgba(232,199,122,0.12); color: var(--gold); }
.align-nav-row { display: flex; justify-content: space-between; width: 100%; }

.align-progress-track { width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
.align-progress-fill { height: 100%; background: linear-gradient(90deg, var(--gold), var(--cyan)); transition: width 0.4s cubic-bezier(.16,1,.3,1); }
.align-q-count { font-size: 12px; color: var(--text-dim); margin-bottom: 22px; letter-spacing: 0.05em; }
.align-q-text { font-family: 'Zen Old Mincho', serif; font-size: 24px; line-height: 1.6; font-weight: 600; margin-bottom: 32px; }
.align-options { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.align-option {
  text-align: left; background: var(--card); border: 1px solid var(--card-border); color: var(--text);
  padding: 16px 20px; border-radius: 14px; font-size: 14.5px; cursor: pointer; line-height: 1.5;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
}
.align-option:hover { border-color: rgba(232,199,122,0.5); background: rgba(255,255,255,0.07); transform: translateX(2px); }
.align-option.selected { border-color: var(--gold); background: rgba(232,199,122,0.12); }
.align-back-floating { margin-top: 26px; }

.align-analyze-ring { position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; margin-bottom: 40px; }
.align-analyze-spinner {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.08); border-top-color: var(--gold); border-right-color: var(--cyan);
  animation: spin 1.4s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.align-analyze-icon { color: var(--gold); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 0.5; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.08); } }
.align-analyze-steps { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
.align-analyze-step { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--text-dim); transition: color 0.3s ease; }
.align-analyze-step.active { color: var(--text); }
.align-analyze-step.done { color: var(--gold); }
.align-analyze-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.align-analyze-step.active .align-analyze-dot { animation: pulse 1s ease-in-out infinite; }

.align-result { display: flex; flex-direction: column; gap: 18px; }
.align-result-hero { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 20px 0 8px; }
.align-gauge { position: relative; width: 220px; height: 220px; margin: 6px 0 18px; }
.align-gauge-svg { width: 100%; height: 100%; }
.align-gauge-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.align-gauge-percent { font-family: 'Zen Old Mincho', serif; font-size: 46px; font-weight: 600; }
.align-gauge-percent span { font-size: 22px; color: var(--text-dim); margin-left: 2px; }
.align-gauge-label { font-size: 12px; color: var(--text-dim); letter-spacing: 0.1em; margin-top: 4px; }
.align-type-name { font-family: 'Zen Old Mincho', serif; font-size: 30px; font-weight: 600; background: linear-gradient(120deg, var(--gold), var(--cyan)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.align-type-label { font-size: 13px; color: var(--text-dim); margin: 4px 0 16px; }
.align-one-liner { font-size: 15px; line-height: 1.8; max-width: 420px; }

.align-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 18px; padding: 22px; backdrop-filter: blur(14px); }
.align-card-label { font-size: 12px; letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 10px; text-transform: uppercase; }
.align-card-text { font-size: 14.5px; line-height: 1.9; }
.align-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 520px) { .align-two-col { grid-template-columns: 1fr; } }
.accent-current { border-color: rgba(127,212,217,0.3); }
.accent-dormant { border-color: rgba(232,199,122,0.35); }
.align-trait-highlight { font-family: 'Zen Old Mincho', serif; font-size: 21px; margin-bottom: 4px; }
.align-trait-score { font-size: 26px; font-weight: 700; color: var(--gold); }
.align-trait-score-sub { font-size: 11px; color: var(--text-dim); font-weight: 400; }

.align-legend { display: flex; gap: 20px; justify-content: center; margin-top: 8px; font-size: 12px; color: var(--text-dim); }
.align-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot.gold { background: var(--gold); }
.dot.cyan { background: var(--cyan); }

.align-story-p { font-size: 14.5px; line-height: 1.95; margin-bottom: 14px; }
.align-story-p:last-child { margin-bottom: 0; color: var(--gold); }

.align-challenge { display: flex; flex-direction: column; gap: 16px; }
.align-challenge-level { border-left: 2px solid var(--gold); padding-left: 14px; }
.align-challenge-num { font-size: 12px; color: var(--gold); font-weight: 700; margin-bottom: 4px; }
.align-challenge-level p { font-size: 14px; line-height: 1.7; }

.align-sns-card { display: flex; justify-content: center; padding: 10px 0; }
.align-poster {
  width: 100%; max-width: 480px; aspect-ratio: 1200 / 630; border-radius: 18px;
  padding: 7% 8%; position: relative; overflow: hidden;
  display: flex; flex-direction: column; justify-content: space-between;
  border: 1px solid rgba(255,255,255,0.12);
  transition: background 0.4s ease;
}
.align-poster-label {
  font-size: 11px; letter-spacing: 0.24em; font-weight: 700; text-transform: uppercase;
  color: rgba(255,255,255,0.85); text-shadow: 0 2px 10px rgba(0,0,0,0.25);
}
.align-poster-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.align-poster-score {
  font-family: 'Zen Old Mincho', serif; font-weight: 800; font-size: clamp(48px, 13vw, 88px);
  color: #fff; line-height: 0.85; display: flex; align-items: baseline;
  text-shadow: 0 6px 30px rgba(0,0,0,0.25);
}
.align-poster-score span { font-size: 34%; margin-left: 6px; }
.align-poster-type {
  font-size: clamp(12px, 2.4vw, 16px); font-weight: 700; color: #fff; text-align: right;
  text-shadow: 0 2px 10px rgba(0,0,0,0.25); padding-bottom: 2px;
}
.align-poster-footer {
  font-size: 10px; color: rgba(255,255,255,0.75); letter-spacing: 0.04em;
  text-shadow: 0 2px 8px rgba(0,0,0,0.25);
}

.align-share-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; align-items: center; }
.align-btn-with-badge { position: relative; display: inline-flex; }
.align-badge-dev {
  position: absolute; top: -9px; right: -8px; font-size: 9px; font-weight: 700;
  letter-spacing: 0.05em; color: #0a0a0f; background: var(--gold, #E8C77A);
  padding: 2px 7px; border-radius: 999px; line-height: 1.4; white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.align-dev-note { text-align: center; font-size: 11px; color: var(--text-dim); margin-top: -6px; }
.align-restart { align-self: center; margin-top: 4px; }

.align-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: rgba(20,20,26,0.95); border: 1px solid var(--card-border); color: var(--text);
  padding: 12px 22px; border-radius: 999px; font-size: 13px; z-index: 10; animation: fadeInUp 0.3s ease both;
}
.align-signature {
  text-align: center; font-size: 10px; letter-spacing: 0.05em; color: rgba(255,255,255,0.25);
  padding: 18px 0 8px;
}
`;
