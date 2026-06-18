/**
 * Style fingerprint — writing-style features beyond raw statistics.
 * Pure text analysis (no LLM).
 */

import { detectDuplicateRhetoric } from "../utils/semantic-duplication.js";
import type { StyleFingerprint } from "../models/style-profile.js";
export type { StyleFingerprint } from "../models/style-profile.js";

const ACTION_VERBS: ReadonlyArray<string> = [
  "走", "跑", "跳", "打", "抓", "推", "拉", "踢", "挥", "冲", "退", "追", "逃",
  "转身", "扑", "撞", "按", "拔", "插", "扔", "接", "躲", "闪", "踏", "踩", "跃",
  "爬", "滚", "翻", "扭", "拧", "扯", "撕", "劈", "斩", "刺", "射", "甩", "抛",
  "投", "挥动", "举起", "放下", "推开", "拉住", "抱住", "甩开", "纵身", "猛地",
];

const PSYCHOLOGICAL_WORDS: ReadonlyArray<string> = [
  "想", "觉得", "感到", "意识到", "明白", "知道", "认为", "怀疑", "担心", "害怕",
  "恐惧", "紧张", "松了口气", "心中", "心底", "暗自", "不由", "不禁", "忍不住",
  "下意识", "本能", "直觉", "思绪", "念头", "感觉", "发觉", "察觉", "醒悟",
];

const SENSORY_WORDS: ReadonlyArray<{
  readonly category: "visual" | "auditory" | "tactile" | "olfactory" | "gustatory";
  readonly words: ReadonlyArray<string>;
}> = [
  {
    category: "visual",
    words: [
      "看", "见", "望", "瞧", "盯", "瞪", "瞥", "扫", "瞄", "注视", "凝视", "环顾",
      "张望", "打量", "观察", "视线", "目光", "眼前", "看见", "望去", "映", "光芒",
      "颜色", "色彩", "明亮", "黑暗", "影子", "轮廓", "景象", "画面",
    ],
  },
  {
    category: "auditory",
    words: [
      "听", "闻", "听到", "听见", "回响", "回荡", "嗡嗡", "寂静", "嘈杂", "喧嚣",
      "声音", "响声", "噪音", "悦耳", "刺耳", "轰鸣", "呼啸", "低语", "咆哮",
      "叮当", "哗啦", "砰", "咚", "咔嚓",
    ],
  },
  {
    category: "tactile",
    words: [
      "摸", "触", "碰", "撞", "疼", "痛", "痒", "麻", "冷", "热", "温暖", "冰凉",
      "粗糙", "光滑", "柔软", "坚硬", "湿润", "干燥", "刺骨", "滚烫", "寒意",
      "触感", "手感", "肌肤", "毛孔", "颤抖", "发抖", "僵硬",
    ],
  },
  {
    category: "olfactory",
    words: [
      "闻", "嗅", "香", "臭", "腥", "刺鼻", "芬芳", "清香", "恶臭", "气味",
      "味道", "幽香", "浓香", "血腥", "霉味", "烟味", "花香", "草香",
    ],
  },
  {
    category: "gustatory",
    words: [
      "尝", "吃", "喝", "甜", "酸", "苦", "辣", "咸", "涩", "鲜美", "可口",
      "美味", "难吃", "醇厚", "清淡", "油腻", "甘甜", "酸涩", "腥甜", "苦味",
    ],
  },
];

const COLLOQUIAL_PARTICLES: ReadonlyArray<string> = [
  "啊", "呢", "吧", "嘛", "呗", "哦", "噢", "嗯", "唉", "哟", "嘿", "哼", "哈", "哇",
  "吗", "么", "喽", "噻", "咯",
];

const HEDGE_WORDS: ReadonlyArray<string> = [
  "似乎", "可能", "或许", "大概", "某种程度上", "一定程度上", "在某种意义上",
  "一定", "必然", "绝对", "毫无疑问",
];

const TRANSITION_WORDS: ReadonlyArray<string> = [
  "然而", "不过", "与此同时", "另一方面", "尽管如此", "话虽如此", "但值得注意的是",
  "更重要的是", "不仅如此", "总而言之", "归根结底",
];

function countMatches(text: string, words: ReadonlyArray<string>): number {
  let count = 0;
  for (const word of words) {
    const regex = new RegExp(word, "g");
    const matches = text.match(regex);
    count += matches?.length ?? 0;
  }
  return count;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function dialogueChars(text: string): number {
  let count = 0;
  const chineseQuote = /[「""']([^「""']+)[」""']/g;
  let m: RegExpExecArray | null;
  while ((m = chineseQuote.exec(text)) !== null) {
    count += m[1].length;
  }
  const lines = text.split(/\n/);
  for (const line of lines) {
    const colonDialogue = /[：:].{3,60}$/;
    if (colonDialogue.test(line.trim())) {
      const idx = line.search(/[：:]/);
      if (idx >= 0) {
        count += Math.min(line.length - idx - 1, 60);
      }
    }
  }
  return Math.min(count, text.length);
}

function sentencesWithAny(text: string, words: ReadonlyArray<string>): number {
  const sents = sentencesOf(text);
  let count = 0;
  for (const sent of sents) {
    for (const word of words) {
      if (sent.includes(word)) {
        count++;
        break;
      }
    }
  }
  return count;
}

function sensoryBreakdown(text: string) {
  const result = { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 };
  for (const group of SENSORY_WORDS) {
    (result as Record<string, number>)[group.category] = countMatches(text, group.words);
  }
  return result;
}

function punctuationCounts(text: string) {
  return {
    comma: (text.match(/，/g) ?? []).length,
    period: (text.match(/[。]/g) ?? []).length,
    question: (text.match(/[？?]/g) ?? []).length,
    exclamation: (text.match(/[！!]/g) ?? []).length,
    ellipsis: (text.match(/[….]{2,}/g) ?? []).length,
    semicolon: (text.match(/[；;]/g) ?? []).length,
    total: text.length,
  };
}

function computeAiTellRisk(text: string): number {
  let risk = 0;
  const totalChars = text.length || 1;

  let hedgeCount = 0;
  for (const word of HEDGE_WORDS) {
    hedgeCount += (text.match(new RegExp(word, "g")) ?? []).length;
  }
  const hedgeDensity = hedgeCount / (totalChars / 1000);
  if (hedgeDensity > 3) risk += 0.3;
  else if (hedgeDensity > 1.5) risk += 0.15;

  let transitionCount = 0;
  for (const word of TRANSITION_WORDS) {
    transitionCount += (text.match(new RegExp(word, "g")) ?? []).length;
  }
  if (transitionCount >= 6) risk += 0.25;
  else if (transitionCount >= 3) risk += 0.1;

  const sentences = sentencesOf(text);
  if (sentences.length >= 3) {
    let maxConsecutive = 1;
    let current = 1;
    for (let i = 1; i < sentences.length; i++) {
      const prev = sentences[i - 1]!.slice(0, 2);
      const curr = sentences[i]!.slice(0, 2);
      if (prev === curr) {
        current++;
        maxConsecutive = Math.max(maxConsecutive, current);
      } else {
        current = 1;
      }
    }
    if (maxConsecutive >= 4) risk += 0.25;
    else if (maxConsecutive >= 3) risk += 0.1;
  }

  const conclusionPatterns = /总而言之|归根结底|综上所述|一言以蔽之|可以说/g;
  const conclusionCount = (text.match(conclusionPatterns) ?? []).length;
  if (conclusionCount >= 2) risk += 0.15;

  return Math.min(Math.round(risk * 100) / 100, 1);
}

export function analyzeStyleFingerprint(text: string): StyleFingerprint {
  const totalChars = text.length || 1;
  const sentences = sentencesOf(text);
  const sentenceCount = sentences.length || 1;

  const dialogueCount = dialogueChars(text);
  const dialogueRatio = Math.min(Math.round((dialogueCount / totalChars) * 100) / 100, 1);

  const actionCount = countMatches(text, ACTION_VERBS);
  const actionDensity = Math.min(Math.round((actionCount / sentenceCount) * 100) / 100, 1);

  const psychoSentences = sentencesWithAny(text, PSYCHOLOGICAL_WORDS);
  const psychologicalRatio = Math.min(Math.round((psychoSentences / sentenceCount) * 100) / 100, 1);

  const sensory = sensoryBreakdown(text);
  const totalSensory = sensory.visual + sensory.auditory + sensory.tactile + sensory.olfactory + sensory.gustatory;
  const sensoryDensity = Math.min(Math.round((totalSensory / sentenceCount) * 100) / 100, 1);

  const particleCount = countMatches(text, COLLOQUIAL_PARTICLES);
  const shortSentences = sentences.filter((s) => s.length < 10).length;
  const questionSentences = (text.match(/[？?]/g) ?? []).length;
  const exclamationSentences = (text.match(/[！!]/g) ?? []).length;
  const colloquialScore = Math.min(
    Math.round(
      (particleCount / sentenceCount * 2 +
        shortSentences / sentenceCount * 0.3 +
        questionSentences / sentenceCount * 0.5 +
        exclamationSentences
      / sentenceCount * 0.5
      ) * 100,
    ) / 100,
    1,
  );

  let rhetoricCount = 0;
  const rhetoricResult = detectDuplicateRhetoric(text, "zh");
  for (const finding of rhetoricResult.findings) {
    rhetoricCount += finding.count;
  }
  const rhetoricDensity = Math.min(Math.round((rhetoricCount / sentenceCount) * 100) / 100, 1);

  const punct = punctuationCounts(text);
  const punctTotal = punct.comma + punct.period + punct.question + punct.exclamation + punct.ellipsis + punct.semicolon || 1;
  const punctuationRhythm = {
    commaRatio: Math.round((punct.comma / punctTotal) * 100) / 100,
    periodRatio: Math.round((punct.period / punctTotal) * 100) / 100,
    questionRatio: Math.round((punct.question / punctTotal) * 100) / 100,
    exclamationRatio: Math.round((punct.exclamation / punctTotal) * 100) / 100,
    ellipsisRatio: Math.round((punct.ellipsis / punctTotal) * 100) / 100,
    semicolonRatio: Math.round((punct.semicolon / punctTotal) * 100) / 100,
  };

  const aiTellRisk = computeAiTellRisk(text);

  return {
    dialogueRatio,
    actionDensity,
    psychologicalRatio,
    sensoryDensity,
    colloquialismScore: colloquialScore,
    rhetoricDensity,
    punctuationRhythm,
    aiTellRisk,
    sensoryBreakdown: {
      visual: Math.round((sensory.visual / (totalSensory || 1)) * 100) / 100,
      auditory: Math.round((sensory.auditory / (totalSensory || 1)) * 100) / 100,
      tactile: Math.round((sensory.tactile / (totalSensory || 1)) * 100) / 100,
      olfactory: Math.round((sensory.olfactory / (totalSensory || 1)) * 100) / 100,
      gustatory: Math.round((sensory.gustatory / (totalSensory || 1)) * 100) / 100,
    },
  };
}
