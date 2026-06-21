/**
 * Canon Import Helpers (D4) — pure prompt constructors extracted from importCanon.
 * These are pure functions with no filesystem or pipeline dependencies.
 */

/** Build the system prompt for canon import LLM call. */
export function buildCanonImportSystemPrompt(): string {
  return `你是一位网络小说架构师。基于正传的全部设定和状态文件，生成一份完整的"正传正典参照"文档，供番外写作和审计使用。

输出格式（Markdown）：
# 正传正典（《{正传书名}》）

## 世界规则（完整，来自正传设定）
（力量体系、地理设定、阵营关系、核心规则——完整复制，不压缩）

## 正典约束（不可违反的事实）
| 约束ID | 类型 | 约束内容 | 严重性 |
|---|---|---|---|
| C01 | 人物存亡 | ... | critical |
（列出所有硬性约束：谁活着、谁死了、什么事件已经发生、什么规则不可违反）

## 角色快照
| 角色 | 当前状态 | 性格底色 | 对话特征 | 已知信息 | 未知信息 |
|---|---|---|---|---|---|
（从状态卡和角色矩阵中提取每个重要角色的完整快照）

## 角色双态处理原则
- 未来会变强的角色：写潜力暗示
- 未来会黑化的角色：写微小裂痕
- 未来会死的角色：写导致死亡的性格底色

## 关键事件时间线
| 章节 | 事件 | 涉及角色 | 对番外的约束 |
|---|---|---|---|
（从章节摘要中提取关键事件）

## 伏笔状态
| Hook ID | 类型 | 状态 | 内容 | 预期回收 |
|---|---|---|---|---|

## 资源账本快照
（当前资源状态）

---
meta:
  parentBookId: "{parentBookId}"
  parentTitle: "{正传书名}"
  generatedAt: "{ISO timestamp}"

要求：
1. 世界规则完整复制，不压缩——准确性优先
2. 正典约束必须穷尽，遗漏会导致番外与正传矛盾
3. 角色快照必须包含信息边界（已知/未知），防止番外中角色引用不该知道的信息`;
}

/** Build the user prompt for canon import LLM call using parent book data. */
export function buildCanonImportUserPrompt(params: {
  parentBookTitle: string;
  parentBookId: string;
  storyBible: string;
  currentState: string;
  ledger: string;
  hooks: string;
  summaries: string;
  subplots: string;
  emotions: string;
  matrix: string;
}): string {
  return `正传书名：${params.parentBookTitle}
正传ID：${params.parentBookId}

## 正传世界设定
${params.storyBible}

## 正传当前状态卡
${params.currentState}

## 正传资源账本
${params.ledger}

## 正传伏笔池
${params.hooks}

## 正传章节摘要
${params.summaries}

## 正传支线进度
${params.subplots}

## 正传情感弧线
${params.emotions}

## 正传角色矩阵
${params.matrix}`;
}

/** Build the deterministic meta block appended to canon output. */
export function buildCanonImportMetaBlock(params: {
  parentBookId: string;
  parentBookTitle: string;
  generatedAt: string;
}): string {
  return [
    "",
    "---",
    "meta:",
    `  parentBookId: "${params.parentBookId}"`,
    `  parentTitle: "${params.parentBookTitle}"`,
    `  generatedAt: "${params.generatedAt}"`,
  ].join("\n");
}
