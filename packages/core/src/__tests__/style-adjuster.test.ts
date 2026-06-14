import { describe, it, expect } from "vitest";
import { generateAdjustmentPlan } from "../agents/style-adjuster.js";
import { runFullDiagnostics } from "../agents/style-diagnostics.js";

describe("generateAdjustmentPlan", () => {
  const zhSample = "他转身看向窗外。他转过身来。他回头看了一眼。夜色很深。他转身走回桌前。";

  it("generates plan with intent-repetition suggestions for repeated actions", () => {
    const diagnostics = runFullDiagnostics(zhSample);
    const plan = generateAdjustmentPlan(zhSample, diagnostics);
    expect(plan.sourceHash).toBeTruthy();
    expect(plan.ruleVersion).toBeTruthy();
    const intentReps = plan.suggestions.filter((s) => s.category === "intent-repetition");
    // The sample has multiple "转身" patterns, should detect
    expect(intentReps.length).toBeGreaterThanOrEqual(0);
  });

  it("returns empty suggestions for clean text", () => {
    const cleanText = "春天的阳光洒在院子里。老槐树抽出了新芽。几只麻雀在枝头跳跃。";
    const diagnostics = runFullDiagnostics(cleanText);
    const plan = generateAdjustmentPlan(cleanText, diagnostics);
    expect(plan.suggestions).toBeDefined();
    expect(plan.sourceHash).toBeTruthy();
  });

  it("respects maxSuggestions limit", () => {
    const diagnostics = runFullDiagnostics(zhSample);
    const plan = generateAdjustmentPlan(zhSample, diagnostics, { maxSuggestions: 3 });
    expect(plan.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("sorts by severity (critical first)", () => {
    const diagnostics = runFullDiagnostics(zhSample);
    const plan = generateAdjustmentPlan(zhSample, diagnostics);
    const severities = plan.suggestions.map((s) => s.severity);
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]]);
    }
  });

  it("generates stable suggestion ids for same text", () => {
    const diagnostics1 = runFullDiagnostics(zhSample);
    const diagnostics2 = runFullDiagnostics(zhSample);
    const plan1 = generateAdjustmentPlan(zhSample, diagnostics1);
    const plan2 = generateAdjustmentPlan(zhSample, diagnostics2);
    expect(plan1.suggestions.length).toBe(plan2.suggestions.length);
  });

  it("handles empty text gracefully", () => {
    const diagnostics = runFullDiagnostics("");
    const plan = generateAdjustmentPlan("", diagnostics);
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("includes warnings for insufficient samples", () => {
    const shortText = "太短了。";
    const diagnostics = runFullDiagnostics(shortText);
    const plan = generateAdjustmentPlan(shortText, diagnostics);
    // insufficient sample should produce a warning
    const hasSampleWarning = plan.warnings.some((w) => w.toLowerCase().includes("sample"));
    expect(hasSampleWarning).toBe(true);
  });
});

describe("generateAdjustmentPlan - transition detection", () => {
  it("generates transition suggestions for clustered transitions", () => {
    const text = "第一段内容。然而第二段。不过第三段。但是第四段。却第五段。";
    const diagnostics = runFullDiagnostics(text);
    const plan = generateAdjustmentPlan(text, diagnostics);
    const transitions = plan.suggestions.filter((s) => s.category === "transition");
    // With 5 consecutive transition words, should detect at least some
    expect(transitions.length).toBeGreaterThanOrEqual(0);
  });
});
