import { describe, it, expect } from "vitest";
import {
  detectIntentRepetition,
  detectRepeatedDescriptions,
  detectTransitionClustering,
  detectClauseComplexity,
  summarizeAIStyleTags,
  runFullDiagnostics,
} from "../agents/style-diagnostics.js";

describe("detectIntentRepetition", () => {
  it("returns empty array for short or empty text", () => {
    expect(detectIntentRepetition("")).toEqual([]);
    expect(detectIntentRepetition("   ")).toEqual([]);
    expect(detectIntentRepetition("一二三四")).toEqual([]); // 4 chars
  });

  it("detects action-expression repetition in Chinese text", () => {
    const text = Array(10)
      .fill("他转过头，看了看窗外。")
      .join("然后，他叹了口气。她又摇了摇头。");
    const findings = detectIntentRepetition(text, 3);

    // Should detect 转身/回头 or 叹气 or 摇头 as repeated
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const action = findings.find((f) => f.kind === "action-expression");
    expect(action).toBeDefined();
    expect(action!.count).toBeGreaterThanOrEqual(2);
    expect(action!.confidence).toBeGreaterThanOrEqual(0.45);
    expect(action!.examples.length).toBeGreaterThan(0);
  });

  it("detects semantic-intent repetition in Chinese text", () => {
    const text =
      "他心想，这条路该怎么走。她觉得，生活并不容易。他意识到，时间已经不多了。" +
      "她寻思，未来会是什么样子。他发现，答案其实很简单。她明白，一切都会好起来的。" +
      "他认为，努力终有回报。她感到，心中充满希望。他知道，明天又是新的一天。" +
      "她觉得，这个世界很大。他想到，梦想不能放弃。";
    const findings = detectIntentRepetition(text, 2);

    const semantic = findings.find((f) => f.kind === "semantic-intent");
    expect(semantic).toBeDefined();
    expect(semantic!.count).toBeGreaterThanOrEqual(2);
    expect(semantic!.perThousandChars).toBeGreaterThan(0);
    expect(semantic!.confidence).toBeGreaterThanOrEqual(0.2);
  });

  it("detects action-expression repetition in English text", () => {
    const text = Array(8)
      .fill("She turned around and looked at the door. ")
      .join("He sighed deeply. ");
    const findings = detectIntentRepetition(text, 2);

    const action = findings.find((f) => f.kind === "action-expression");
    expect(action).toBeDefined();
    expect(action!.count).toBeGreaterThanOrEqual(2);
  });

  it("detects semantic-intent repetition in English text", () => {
    const text =
      "He thought about the problem. She felt uneasy. They wondered what would happen. " +
      "He realized it was too late. She knew the answer. They believed in hope. " +
      "He decided to leave. She thought about her past. They felt a strange sensation. " +
      "He wondered if it was true. She realized her mistake. ";
    const findings = detectIntentRepetition(text, 2);

    const semantic = findings.find((f) => f.kind === "semantic-intent");
    expect(semantic).toBeDefined();
    expect(semantic!.count).toBeGreaterThanOrEqual(2);
  });

  it("reduces confidence for short samples", () => {
    // ~300 chars, below 500 threshold but with repeated patterns
    const text = Array(12).fill("他转过头。").join("");
    const findings = detectIntentRepetition(text, 1);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      // Short sample penalty should reduce confidence
      expect(f.confidence).toBeLessThanOrEqual(0.8);
      // Severity should not be high for short samples
      expect(f.severity).not.toBe("high");
    }
  });

  it("grades severity based on frequency and density", () => {
    // Very high repetition density
    const text = Array(20)
      .fill("他转过头。")
      .join("");
    const findings = detectIntentRepetition(text, 1);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    // Short text (<500 chars) caps severity at low regardless of density
    expect(findings[0].severity).toBe("low");
  });

  it("returns sorted results (high severity first)", () => {
    const text =
      "他转过头。她叹了口气。他又摇了摇头。她点了点头。他看向窗外。她望向远方。" +
      "他心想，未来会怎样。她觉得，生活并不容易。他意识到，时间已经不多了。";
    const findings = detectIntentRepetition(text, 1);

    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1];
      const curr = findings[i];
      // high(3) >= medium(2) >= low(1)
      const order = { high: 3, medium: 2, low: 1 };
      expect(order[prev.severity]).toBeGreaterThanOrEqual(order[curr.severity]);
    }
  });

  it("includes position info in examples", () => {
    const text = "他转过头。她叹了口气。他又摇了摇头。";
    const findings = detectIntentRepetition(text, 1);
    for (const f of findings) {
      for (const ex of f.examples) {
        expect(ex.start).toBeGreaterThanOrEqual(0);
        expect(ex.end).toBeGreaterThan(ex.start);
        expect(ex.sentence.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("runFullDiagnostics", () => {
  it("returns full diagnostics with sourceHash and sampleAdequacy", () => {
    const result = runFullDiagnostics("这是一个测试文本。他转过头，叹了口气。", "zh");
    expect(result.sourceHash).toBeDefined();
    expect(result.sourceHash.length).toBeGreaterThan(0);
    expect(result.ruleVersion).toBe("1.0.0");
    expect(result.sampleAdequacy).toBe("insufficient"); // < 500 chars
    expect(Array.isArray(result.intentRepetitions)).toBe(true);
    expect(Array.isArray(result.repeatedDescriptions)).toBe(true);
    expect(Array.isArray(result.transitionClustering)).toBe(true);
    expect(Array.isArray(result.clauseComplexity)).toBe(true);
    expect(typeof result.aiStyleTags).toBe("object");
    expect(result.aiStyleTags).not.toBeNull();
  });

  it("grades sample adequacy correctly", () => {
    const short = runFullDiagnostics("短。", "zh");
    expect(short.sampleAdequacy).toBe("insufficient");

    const medium = runFullDiagnostics("文".repeat(1000), "zh");
    expect(medium.sampleAdequacy).toBe("limited");

    const long = runFullDiagnostics("文".repeat(3000), "zh");
    expect(long.sampleAdequacy).toBe("sufficient");
  });

  it("produces stable sourceHash for same text", () => {
    const text = "稳定性测试文本。";
    const a = runFullDiagnostics(text, "zh");
    const b = runFullDiagnostics(text, "zh");
    expect(a.sourceHash).toBe(b.sourceHash);
  });
});

describe("detectRepeatedDescriptions", () => {
  it("returns empty array for short text", () => {
    expect(detectRepeatedDescriptions("")).toEqual([]);
    expect(detectRepeatedDescriptions("一二三四")).toEqual([]);
  });

  it("detects repeated eye descriptions in Chinese", () => {
    const sentences = [
      "她的眼睛像星星一样闪亮。",
      "他的目光深邃而迷人。",
      "她的眼神中充满了温柔。",
      "他转过头，双眸中闪烁着光芒。",
      "她的瞳孔微微收缩。",
      "他的眼角带着笑意。",
      "她的眼眸中倒映着月光。",
      "他的目光始终没有离开她。",
      "她的眼睛湿润了。",
      "他的眼神变得坚定。",
    ];
    const text = sentences.join("\n\n");
    const findings = detectRepeatedDescriptions(text);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const eyeFinding = findings.find((f) => f.cluster.includes("眼睛") || f.cluster.includes("目光"));
    expect(eyeFinding).toBeDefined();
    expect(eyeFinding!.occurrences.length).toBeGreaterThanOrEqual(3);
    expect(eyeFinding!.confidence).toBeGreaterThan(0);
  });

  it("detects repeated expression descriptions in Chinese", () => {
    const sentences = [
      "他的表情十分严肃。",
      "她的神情有些紧张。",
      "他的脸色变得苍白。",
      "她的面容上露出微笑。",
      "他的神态显得格外专注。",
      "她的神色变得柔和。",
      "他的表情缓和了一些。",
      "她的神情中带着一丝忧虑。",
      "他的脸色渐渐恢复了正常。",
    ];
    const text = sentences.join("\n\n");
    const findings = detectRepeatedDescriptions(text);

    const exprFinding = findings.find((f) => f.cluster.includes("表情"));
    expect(exprFinding).toBeDefined();
    expect(exprFinding!.occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty when no repeated descriptions", () => {
    const text = "这是一个普通的故事。主角走过了街道。天色渐渐暗了下来。";
    const findings = detectRepeatedDescriptions(text);
    expect(findings.length).toBe(0);
  });

  it("caps severity for short samples", () => {
    const text = "眼睛。目光。眼神。双眸。瞳孔。";
    const findings = detectRepeatedDescriptions(text);
    if (findings.length > 0) {
      expect(findings[0].severity).not.toBe("high");
    }
  });

  it("detects repeated descriptions in English", () => {
    const text = [
      "Her eyes were bright blue.",
      "His gaze was fixed on the horizon.",
      "She looked at him with gentle eyes.",
      "His stare was intense and unwavering.",
      "Her glance was fleeting but meaningful.",
    ].join("\n\n");
    const findings = detectRepeatedDescriptions(text);

    const eyeFinding = findings.find((f) => f.cluster.includes("eyes") || f.cluster.includes("gaze"));
    expect(eyeFinding).toBeDefined();
    expect(eyeFinding!.occurrences.length).toBeGreaterThanOrEqual(2);
  });
});

describe("detectTransitionClustering", () => {
  it("returns empty array for short text", () => {
    expect(detectTransitionClustering("")).toEqual([]);
    expect(detectTransitionClustering("一二三四")).toEqual([]);
  });

  it("detects clustered transitions in Chinese", () => {
    const paragraphs = [
      "他走进了房间。然后，他看到了桌上的信。然后，他注意到信封上没有署名。",
      "然而，信已经被人打开过了。然而，里面的内容却让他大吃一惊。",
      "不过，他还是决定读下去。不过，他的手有些颤抖。",
      "于是，他拿起了那封信。于是，他开始仔细阅读。",
      "接着，他发现里面有一张地图。接着，他看到了地图上的标记。",
      "但是，地图上的标记让他感到不安。但是，他还是决定继续追查。",
    ];
    const text = paragraphs.join("\n\n");
    const findings = detectTransitionClustering(text, "zh");

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const topFinding = findings[0];
    expect(topFinding.totalCount).toBeGreaterThanOrEqual(2);
    expect(topFinding.paragraphsWithTransition).toBeGreaterThanOrEqual(1);
    expect(topFinding.paragraphRatio).toBeGreaterThanOrEqual(0);
  });

  it("detects consecutive transitions", () => {
    const paragraphs = [
      "他走进了房间。然后，他看到了桌上的信。然后，他注意到信封上没有署名。然而，信已经被人打开过了。他感到十分惊讶。",
      "于是，他拿起了那封信。于是，他开始仔细阅读。接着，他发现里面有一张地图。接着，他看到了地图上的标记。他决定追查下去。",
    ];
    const text = paragraphs.join("\n\n");
    const findings = detectTransitionClustering(text, "zh");

    expect(findings.length).toBeGreaterThanOrEqual(1);
    // Should have some transitions with consecutive hits
    const withConsecutive = findings.find((f) => f.consecutiveTransitions >= 1);
    expect(withConsecutive).toBeDefined();
  });

  it("detects transitions in English", () => {
    const paragraphs = [
      "He entered the room. Then he saw the letter on the table. Then he noticed the envelope had no name.",
      "However, the letter had already been opened. However, the contents surprised him.",
      "Nevertheless, he decided to read it. Nevertheless, his hands trembled slightly.",
      "Therefore, he picked up the letter. Therefore, he began to read carefully.",
      "Moreover, he found a map inside. Moreover, he saw markings on the map.",
      "But the markings on the map made him uneasy. But he decided to investigate further.",
    ];
    const text = paragraphs.join("\n\n");
    const findings = detectTransitionClustering(text, "en");

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const top = findings[0];
    expect(top.totalCount).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when no transitions", () => {
    const text = "这是一个普通的故事。主角走过了街道。天色渐渐暗了下来。";
    const findings = detectTransitionClustering(text, "zh");
    expect(findings.length).toBe(0);
  });
});

describe("detectClauseComplexity", () => {
  it("returns empty array for short text", () => {
    expect(detectClauseComplexity("")).toEqual([]);
    expect(detectClauseComplexity("一二三四", "zh")).toEqual([]);
  });

  it("detects complex Chinese sentences", () => {
    const text =
      "这是一个简单的句子。" +
      "虽然他不知道该怎么办，但是因为他已经答应了，所以无论如何都必须坚持到底，即使前方充满了未知的危险。" +
      "天色暗了下来。";
    const findings = detectClauseComplexity(text, "zh");

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const complex = findings.find((f) => f.estimatedClauseCount >= 3);
    expect(complex).toBeDefined();
    expect(complex!.hasNestedClause).toBe(true);
    expect(complex!.severity).toBe("medium");
    expect(complex!.sentenceLength).toBeGreaterThan(40);
  });

  it("detects complex English sentences", () => {
    const text =
      "This is simple. " +
      "Although he did not know what to do, because he had already promised, he must persevere no matter what, even if the road ahead was full of unknown dangers. " +
      "It got dark.";
    const findings = detectClauseComplexity(text, "en");

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const complex = findings.find((f) => f.estimatedClauseCount >= 2);
    expect(complex).toBeDefined();
    expect(complex!.hasNestedClause).toBe(true);
  });

  it("sorts by severity", () => {
    const text =
      "虽然他不知道该怎么办，但是因为他已经答应了，所以无论如何都必须坚持到底，即使前方充满了未知的危险。" +
      "这是一个中等长度的句子，因为它有一些连接词。" +
      "这是一个非常长的句子，而且非常复杂，因为它包含了很多连接词和分隔符，所以读者可能会感到困惑。";
    const findings = detectClauseComplexity(text, "zh");

    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1];
      const curr = findings[i];
      const order = { high: 3, medium: 2, low: 1 };
      expect(order[prev.severity]).toBeGreaterThanOrEqual(order[curr.severity]);
    }
  });
});

describe("summarizeAIStyleTags", () => {
  it("returns default for empty text", () => {
    const summary = summarizeAIStyleTags("");
    expect(summary.heuristicRiskScore).toBe(0);
    expect(summary.confidence).toBeLessThan(0.3);
    expect(summary.sampleAdequacy).toBe("insufficient");
  });

  it("detects hedge words in Chinese", () => {
    const text = Array(10)
      .fill("他似乎明白了什么。她大概知道答案。他可能已经走了。")
      .join("");
    const summary = summarizeAIStyleTags(text, "zh");

    expect(summary.hedgeWordDensity).toBeGreaterThan(0);
    expect(summary.metaNarrationCount).toBe(0);
    expect(summary.confidence).toBeGreaterThan(0);

    const hedgeItem = summary.breakdown.find((b) => b.tag === "hedge_words");
    expect(hedgeItem).toBeDefined();
    expect(hedgeItem!.count).toBeGreaterThanOrEqual(2);
  });

  it("detects meta narration in Chinese", () => {
    const text =
      "故事回到了十年前。让我们把目光转向窗外。正如前文所述，这件事并不简单。" +
      "读者可能会想，他为什么要这样做。让我们回到正题。" +
      "值得一提的是，数据显示这种情况并不罕见。";
    const summary = summarizeAIStyleTags(text, "zh");

    expect(summary.metaNarrationCount).toBeGreaterThanOrEqual(1);
    expect(summary.reportTermCount).toBeGreaterThanOrEqual(1);

    const metaItem = summary.breakdown.find((b) => b.tag === "meta_narration");
    expect(metaItem).toBeDefined();
  });

  it("detects collective shock in Chinese", () => {
    const text =
      "所有人都惊呆了。全场哗然。众人面面相觑。" +
      "所有人都愣住了。全场一片死寂。" +
      "这是一个很长的铺垫文本，用来确保总长度超过五十个字符的最低阈值要求。";
    const summary = summarizeAIStyleTags(text, "zh");

    expect(summary.collectiveShockCount).toBeGreaterThanOrEqual(2);
  });

  it("detects AI-style patterns in English", () => {
    const text =
      "It is worth noting that the data shows significant results. " +
      "However, the reader might think this is too simplistic. " +
      "In conclusion, we should recognize the importance of this finding. " +
      "Everyone was stunned by the revelation. ";
    const summary = summarizeAIStyleTags(text, "en");

    expect(summary.breakdown.length).toBeGreaterThanOrEqual(2);
    expect(summary.heuristicRiskScore).toBeGreaterThan(0);
    expect(summary.confidence).toBeGreaterThan(0);
  });

  it("grades sample adequacy", () => {
    const short = summarizeAIStyleTags("短。", "zh");
    expect(short.sampleAdequacy).toBe("insufficient");

    const medium = summarizeAIStyleTags("文".repeat(1000), "zh");
    expect(medium.sampleAdequacy).toBe("limited");

    const long = summarizeAIStyleTags("文".repeat(3000), "zh");
    expect(long.sampleAdequacy).toBe("sufficient");
  });
});
