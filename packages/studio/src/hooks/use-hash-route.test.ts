import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "./use-hash-route";

describe("hash route", () => {
  describe("parseHash", () => {
    it("parses empty hash as dashboard", () => {
      expect(parseHash("")).toEqual({ page: "dashboard" });
    });

    it("parses #/ as dashboard", () => {
      expect(parseHash("#/")).toEqual({ page: "dashboard" });
    });

    it("parses chat route", () => {
      expect(parseHash("#/chat")).toEqual({ page: "chat" });
    });

    it("parses book route", () => {
      expect(parseHash("#/book/my-novel")).toEqual({ page: "book", bookId: "my-novel" });
    });

    it("parses book settings route", () => {
      expect(parseHash("#/book/my-novel/settings")).toEqual({ page: "book-settings", bookId: "my-novel" });
    });

    it("decodes encoded bookId", () => {
      expect(parseHash("#/book/%E4%B9%9D%E9%BE%99")).toEqual({ page: "book", bookId: "九龙" });
    });

    it("parses book/new as book-create", () => {
      expect(parseHash("#/book/new")).toEqual({ page: "book-create" });
    });

    it("parses config as services (redirect)", () => {
      expect(parseHash("#/config")).toEqual({ page: "services" });
    });

    it("parses services", () => {
      expect(parseHash("#/services")).toEqual({ page: "services" });
    });

    it("parses service-detail", () => {
      expect(parseHash("#/services/openai")).toEqual({ page: "service-detail", serviceId: "openai" });
    });

    it("decodes encoded serviceId", () => {
      expect(parseHash("#/services/%E8%87%AA%E5%AE%9A%E4%B9%89")).toEqual({ page: "service-detail", serviceId: "自定义" });
    });

    it("parses chapter route", () => {
      expect(parseHash("#/chapter/my-novel/3")).toEqual({
        page: "chapter",
        bookId: "my-novel",
        chapterNumber: 3,
      });
    });

    it("decodes encoded bookId in chapter route", () => {
      expect(parseHash("#/chapter/%E4%B9%9D%E9%BE%99/12")).toEqual({
        page: "chapter",
        bookId: "九龙",
        chapterNumber: 12,
      });
    });

    it("parses truth route", () => {
      expect(parseHash("#/truth/my-novel")).toEqual({
        page: "truth",
        bookId: "my-novel",
      });
    });

    it("decodes encoded bookId in truth route", () => {
      expect(parseHash("#/truth/%E4%B9%9D%E9%BE%99")).toEqual({
        page: "truth",
        bookId: "九龙",
      });
    });

    it("falls back to dashboard for chapter zero", () => {
      expect(parseHash("#/chapter/my-novel/0")).toEqual({ page: "dashboard" });
    });

    it("falls back to dashboard for a nonnumeric chapter", () => {
      expect(parseHash("#/chapter/my-novel/abc")).toEqual({ page: "dashboard" });
    });

    it("falls back to dashboard for unknown hash", () => {
      expect(parseHash("#/unknown/route")).toEqual({ page: "dashboard" });
    });
  });

  describe("routeToHash", () => {
    it("dashboard -> #/", () => {
      expect(routeToHash({ page: "dashboard" })).toBe("#/");
    });

    it("chat -> #/chat", () => {
      expect(routeToHash({ page: "chat" })).toBe("#/chat");
    });

    it("book -> #/book/{id}", () => {
      expect(routeToHash({ page: "book", bookId: "novel-1" })).toBe("#/book/novel-1");
    });

    it("book-settings -> #/book/{id}/settings", () => {
      expect(routeToHash({ page: "book-settings", bookId: "novel-1" })).toBe("#/book/novel-1/settings");
    });

    it("encodes Chinese bookId", () => {
      const hash = routeToHash({ page: "book", bookId: "九龙城夜行" });
      expect(hash).toContain("#/book/");
      expect(decodeURIComponent(hash)).toContain("九龙城夜行");
    });

    it("book-create -> #/book/new", () => {
      expect(routeToHash({ page: "book-create" })).toBe("#/book/new");
    });

    it("services -> #/services", () => {
      expect(routeToHash({ page: "services" })).toBe("#/services");
    });

    it("service-detail -> #/services/{id}", () => {
      expect(routeToHash({ page: "service-detail", serviceId: "openai" })).toBe("#/services/openai");
    });

    it("encodes Chinese serviceId", () => {
      const hash = routeToHash({ page: "service-detail", serviceId: "自定义" });
      expect(hash).toContain("#/services/");
      expect(decodeURIComponent(hash)).toContain("自定义");
    });

    it("serializes chapter route", () => {
      expect(routeToHash({ page: "chapter", bookId: "my-novel", chapterNumber: 3 }))
        .toBe("#/chapter/my-novel/3");
    });

    it("serializes truth route", () => {
      expect(routeToHash({ page: "truth", bookId: "my-novel" }))
        .toBe("#/truth/my-novel");
    });

    it("round-trips a chapter route with a Chinese bookId", () => {
      const route = { page: "chapter", bookId: "九龙城夜行", chapterNumber: 12 } as const;
      expect(parseHash(routeToHash(route))).toEqual(route);
    });

    it("round-trips a truth route with a Chinese bookId", () => {
      const route = { page: "truth", bookId: "九龙城夜行" } as const;
      expect(parseHash(routeToHash(route))).toEqual(route);
    });

    it("static pages map to stable hash routes", () => {
      expect(routeToHash({ page: "daemon" })).toBe("#/daemon");
      expect(routeToHash({ page: "logs" })).toBe("#/logs");
    });
  });
});
