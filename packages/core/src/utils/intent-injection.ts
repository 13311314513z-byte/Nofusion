/**
 * Intent Injection — renders the author's pre-writing answers into prompt
 * blocks for Planner, Writer, and Auditor.
 *
 * This is the bridge between "what the author said they want" (ChapterIntent)
 * and "what the Agent reads in its prompt". The output is a formatted markdown
 * block injected near the top of each Agent's context, before any task instructions.
 */

import type { AuthorChapterIntent } from "../models/chapter-intent.js";

/**
 * Build a markdown block from the author's chapter intent.
 *
 * The output is designed to be injected near the **top** of the Agent prompt,
 * right after the system prompt and before the task instructions, so the Agent
 * reads "the author wants this" before it reads "your job is to write this".
 */
export function buildAuthorIntentBlock(intent: AuthorChapterIntent): string {
  const lines: string[] = [];

  lines.push("📝 作者说这一章：");
  lines.push("");

  // Level 1: Core — always present
  if (intent.coreNarrative) {
    lines.push(`  【核心】${intent.coreNarrative}`);
  }
  if (intent.readerTakeaway) {
    lines.push(`  【读者感受】${intent.readerTakeaway}`);
  }
  if (intent.keyMoment) {
    lines.push(`  【关键画面】${intent.keyMoment}`);
  }
  lines.push("");

  // Level 2: Scenes
  if (intent.scenes && intent.scenes.length > 0) {
    lines.push(`  场景规划（${intent.scenes.length} 个场景）:`);
    for (let i = 0; i < intent.scenes.length; i++) {
      const s = intent.scenes[i];
      const emotion = s.targetEmotion ? ` [${s.targetEmotion}]` : "";
      lines.push(`    ${i + 1}. ${s.goal} | ${s.location} | ${s.povCharacter}${emotion}`);
    }
    lines.push("");
  }

  // Level 3: Character states
  if (intent.characterStates && intent.characterStates.length > 0) {
    lines.push("  🎭 角色状态:");
    for (const cs of intent.characterStates) {
      const rel = cs.relationshipChanges ? ` (关系: ${cs.relationshipChanges})` : "";
      lines.push(`    ${cs.characterId}: ${cs.emotion}${rel}`);
    }
    lines.push("");
  }

  // Level 4: Constraints
  const constraints: string[] = [];
  if (intent.requiredBeats && intent.requiredBeats.length > 0) {
    constraints.push(...intent.requiredBeats.map((b) => `  ✅ ${b}`));
  }
  if (intent.forbiddenMoves && intent.forbiddenMoves.length > 0) {
    constraints.push(...intent.forbiddenMoves.map((b) => `  ❌ ${b}`));
  }
  if (intent.pendingHookIds && intent.pendingHookIds.length > 0) {
    constraints.push(`  🔗 待回收伏笔: ${intent.pendingHookIds.join(", ")}`);
  }
  if (intent.narrativePosition) {
    constraints.push(`  📍 叙事位置: ${intent.narrativePosition}`);
  }
  if (intent.plotLine) {
    constraints.push(`  📖 故事线: ${intent.plotLine}`);
  }

  if (constraints.length > 0) {
    lines.push("  📋 约束与提醒:");
    lines.push(...constraints);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build an "author commitment checklist" block for the Auditor.
 *
 * This tells the auditor: "the author promised these things; check if they
 * were delivered." Returns empty string if there are no checkable items.
 */
export function buildAuthorCommitmentChecklist(intent: AuthorChapterIntent): string {
  const items: string[] = [];

  if (intent.readerTakeaway) {
    items.push(`- [ ] 读者感受兑现: "${intent.readerTakeaway}"`);
  }
  if (intent.keyMoment) {
    items.push(`- [ ] 关键画面出现: "${intent.keyMoment}"`);
  }
  if (intent.requiredBeats && intent.requiredBeats.length > 0) {
    for (const beat of intent.requiredBeats) {
      items.push(`- [ ] 必达事件: "${beat}"`);
    }
  }
  if (intent.forbiddenMoves && intent.forbiddenMoves.length > 0) {
    for (const move of intent.forbiddenMoves) {
      items.push(`- [ ] 禁止事项未出现: "${move}"`);
    }
  }

  if (items.length === 0) return "";

  return [
    "",
    "📋 作者承诺清单（请在检查时逐项核对）:",
    ...items,
    "",
  ].join("\n");
}

/**
 * Format an intent summary suitable for the Writer prompt's opening section.
 * This is a concise version (no scene breakdown, just core + character states).
 */
export function buildWriterIntentBrief(intent: AuthorChapterIntent): string {
  const parts: string[] = [];

  if (intent.coreNarrative) {
    parts.push(`核心: ${intent.coreNarrative}`);
  }
  if (intent.readerTakeaway) {
    parts.push(`读者目标: ${intent.readerTakeaway}`);
  }
  if (intent.keyMoment) {
    parts.push(`关键时刻: ${intent.keyMoment}`);
  }
  if (intent.narrativePosition && (intent.coreNarrative || intent.readerTakeaway || intent.keyMoment)) {
    parts.push(`位置: ${intent.narrativePosition}`);
  }

  return parts.join(" | ");
}

// ─── Endpoint Lock injection ────────────────────────────────────────

/**
 * Build the Endpoint Lock section for the Writer system prompt.
 *
 * When the author has specified an opening frame, closing frame, and/or
 * path constraints, this section locks down the start and end of the chapter,
 * giving the Writer creative freedom only in "how to get from A to B".
 *
 * Returns empty string if neither openingFrame nor closingFrame is provided.
 */
export function buildEndpointLockSection(
  openingFrame?: AuthorChapterIntent["openingFrame"],
  closingFrame?: AuthorChapterIntent["closingFrame"],
  pathConstraints?: AuthorChapterIntent["pathConstraints"],
): string {
  if (!openingFrame && !closingFrame) return "";

  const lines: string[] = [];

  lines.push("## 端点锁定（Endpoint Lock）");
  lines.push("");
  lines.push("本章的开头和结尾已被作者指定，你必须严格遵守：");
  lines.push("");

  // ── Opening frame ──────────────────────────────────────────
  if (openingFrame) {
    lines.push("### 开头画面（不可偏离）");
    lines.push(openingFrame.scene);
    lines.push("");
    if (openingFrame.povCharacter) {
      lines.push(`视角角色：${openingFrame.povCharacter}`);
    }
    lines.push(`开头情绪：${openingFrame.openingMood}`);
    if (openingFrame.firstLine) {
      lines.push(`第一句话：${openingFrame.firstLine}`);
    }
    if (openingFrame.forbiddenOpenings && openingFrame.forbiddenOpenings.length > 0) {
      lines.push(`禁止的开头方式：${openingFrame.forbiddenOpenings.join("、")}`);
    }
    lines.push("");
  }

  // ── Closing frame ──────────────────────────────────────────
  if (closingFrame) {
    lines.push("### 结尾画面（必须收敛至此）");
    lines.push(closingFrame.scene);
    lines.push("");
    if (closingFrame.povCharacter) {
      lines.push(`视角角色：${closingFrame.povCharacter}`);
    }
    lines.push(`结尾情绪：${closingFrame.closingMood}`);
    if (closingFrame.lastLine) {
      lines.push(`最后一句话：${closingFrame.lastLine}`);
    }
    if (closingFrame.mustResolve && closingFrame.mustResolve.length > 0) {
      lines.push(`必须在结尾前解决：${closingFrame.mustResolve.join("、")}`);
    }
    if (closingFrame.mustSetup && closingFrame.mustSetup.length > 0) {
      lines.push(`必须在结尾前铺垫：${closingFrame.mustSetup.join("、")}`);
    }
    // Conditional branch endings
    if (closingFrame.branches && closingFrame.branches.length > 0) {
      lines.push("");
      lines.push("**条件分支结局（根据中间情节选择最合适的）**：");
      for (const branch of closingFrame.branches) {
        lines.push(`- **如果** ${branch.condition}：结尾情绪为「${branch.closingMood}」${branch.lastLine ? `，最后一句话：「${branch.lastLine}」` : ""}`);
      }
    }
    lines.push("");
  }

  // ── Path constraints ───────────────────────────────────────
  if (pathConstraints) {
    lines.push("### 路径约束");
    if (pathConstraints.maxSceneCount) {
      lines.push(`最大场景数：${pathConstraints.maxSceneCount}`);
    }
    if (pathConstraints.mustPassThrough && pathConstraints.mustPassThrough.length > 0) {
      lines.push(`必须经过：${pathConstraints.mustPassThrough.join(" → ")}`);
    }
    if (pathConstraints.mustNotSkip && pathConstraints.mustNotSkip.length > 0) {
      lines.push(`不可跳过：${pathConstraints.mustNotSkip.join("、")}`);
    }
    lines.push(`情绪转变方式：${pathConstraints.toneShift === "sudden" ? "突然转折" : pathConstraints.toneShift === "gradual" ? "渐变过渡" : "保持稳定"}`);
    lines.push("");
  }

  // ── Writing requirements ───────────────────────────────────
  lines.push("### 写作要求");
  lines.push("1. 从开头画面开始，不能在此之前增加任何过渡段落");
  lines.push("2. 在结尾画面结束，不能在此之后增加任何收尾段落");
  lines.push("3. 中间的情节推进必须自然地连接两端，不能跳脱");
  lines.push("4. 保持与开头情绪→结尾情绪一致的转变曲线");
  lines.push("5. 如果开头和结尾已经确定，你的创造性发挥空间在「如何从 A 走到 B」");

  return lines.join("\n");
}
