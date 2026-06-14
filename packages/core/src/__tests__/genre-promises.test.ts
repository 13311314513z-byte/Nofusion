import { describe, it, expect } from "vitest";
import { checkGenrePromises, getCriticalGenrePromises } from "../evaluation/genre-promises.js";
import type { GenreProfile } from "../models/genre-profile.js";

function makeProfile(promises: GenreProfile["promises"]): GenreProfile {
  return {
    id: "test",
    name: "测试",
    language: "zh",
    chapterTypes: [],
    fatigueWords: [],
    pacingRule: "",
    numericalSystem: false,
    powerScaling: false,
    eraResearch: false,
    auditDimensions: [],
    satisfactionTypes: [],
    promises: promises ?? [],
  };
}

describe("checkGenrePromises", () => {
  it("returns no results when there are no promises", () => {
    const result = checkGenrePromises(makeProfile([]), 1, 0);
    expect(result).toHaveLength(0);
  });

  it("reports pending for a promise whose window starts in the future", () => {
    const profile = makeProfile([
      {
        id: "p1",
        description: "主角获得金手指",
        importance: "core",
        scope: "book",
        expectedWindow: { from: 5, to: 10 },
        overduePolicy: "warning",
      },
    ]);
    const result = checkGenrePromises(profile, 3, 0);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
    expect(result[0].severity).toBe("info"); // non-overdue → info
  });

  it("reports overdue when chapter past the window", () => {
    const profile = makeProfile([
      {
        id: "p2",
        description: "反派揭露身份",
        importance: "core",
        scope: "arc",
        expectedWindow: { from: 5, to: 10 },
        overduePolicy: "warning",
      },
    ]);
    const result = checkGenrePromises(profile, 12, 0);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("overdue");
    expect(result[0].severity).toBe("warning"); // from overduePolicy
  });

  it("reports overdue with critical severity when overduePolicy is critical", () => {
    const profile = makeProfile([
      {
        id: "p3",
        description: "主角必须完成试炼",
        importance: "core",
        scope: "book",
        expectedWindow: { from: 1, to: 20 },
        overduePolicy: "critical",
      },
    ]);
    const result = checkGenrePromises(profile, 25, 0);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("overdue");
    expect(result[0].severity).toBe("critical");
  });

  it("returns pending for promise without window within reasonable chapter", () => {
    const profile = makeProfile([
      {
        id: "p4",
        description: "日常温馨情节",
        importance: "expected",
        scope: "chapter-type",
        overduePolicy: "info",
      },
    ]);
    const result = checkGenrePromises(profile, 1, 0);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
  });
});

describe("getCriticalGenrePromises", () => {
  it("filters only overdue promises", () => {
    const profile = makeProfile([
      {
        id: "p1",
        description: "早期承诺",
        importance: "core",
        scope: "book",
        expectedWindow: { from: 1, to: 5 },
        overduePolicy: "warning",
      },
      {
        id: "p2",
        description: "后期承诺",
        importance: "core",
        scope: "book",
        expectedWindow: { from: 10, to: 20 },
        overduePolicy: "warning",
      },
    ]);
    const critical = getCriticalGenrePromises(profile, 8, 0);
    expect(critical).toHaveLength(1);
    expect(critical[0].promiseId).toBe("p1");
  });
});
