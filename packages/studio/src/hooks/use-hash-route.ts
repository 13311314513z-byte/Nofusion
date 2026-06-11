import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "chat" }
  | { page: "book"; bookId: string; section?: string }
  | { page: "book-settings"; bookId: string }
  | { page: "book-create" }
  | { page: "services" }
  | { page: "service-detail"; serviceId: string }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" }
  | { page: "audit" }
  | { page: "automation" }
  | { page: "cover-config" };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "chat") return { page: "chat" };
  if (path === "config" || path === "services") return { page: "services" };
  if (path === "book/new") return { page: "book-create" };

  const serviceMatch = path.match(/^services\/([^/]+)$/);
  if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };

  const bookSettingsMatch = path.match(/^book\/([^/]+)\/settings$/);
  if (bookSettingsMatch) return { page: "book-settings", bookId: decodeURIComponent(bookSettingsMatch[1]) };

  const bookMatch = path.match(/^book\/([^/]+)$/);
  if (bookMatch) return { page: "book", bookId: decodeURIComponent(bookMatch[1]) };

  const bookSectionMatch = path.match(/^book\/([^/]+)\/([^/]+)$/);
  if (bookSectionMatch) {
    return {
      page: "book",
      bookId: decodeURIComponent(bookSectionMatch[1]),
      section: decodeURIComponent(bookSectionMatch[2]),
    };
  }

  // Routes without dynamic parameters
  const staticRoutes: Record<string, HashRoute> = {
    "daemon": { page: "daemon" },
    "logs": { page: "logs" },
    "genres": { page: "genres" },
    "style": { page: "style" },
    "import": { page: "import" },
    "radar": { page: "radar" },
    "doctor": { page: "doctor" },
    "diagnostics": { page: "doctor" },
    "audit": { page: "audit" },
    "automation": { page: "automation" },
    "cover-config": { page: "cover-config" },
    cover: { page: "cover-config" },
  };
  // Dynamic analytics route: #/analytics/<bookId>
  const analyticsMatch = path.match(/^analytics\/([^/]+)$/);
  if (analyticsMatch) {
    return { page: "analytics", bookId: decodeURIComponent(analyticsMatch[1]) };
  }
  if (staticRoutes[path]) return staticRoutes[path];

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "chat": return "#/chat";
    case "book": {
      const base = `#/book/${encodeURIComponent(route.bookId)}`;
      return route.section ? `${base}/${encodeURIComponent(route.section)}` : base;
    }
    case "book-settings": return `#/book/${encodeURIComponent(route.bookId)}/settings`;
    case "book-create": return "#/book/new";
    case "services": return "#/services";
    case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
    case "daemon": return "#/daemon";
    case "logs": return "#/logs";
    case "genres": return "#/genres";
    case "style": return "#/style";
    case "import": return "#/import";
    case "radar": return "#/radar";
    case "doctor": return "#/doctor";
    case "audit": return "#/audit";
    case "analytics": return `#/analytics/${encodeURIComponent(route.bookId)}`;
    case "automation": return "#/automation";
    case "cover-config": return "#/cover-config";
    default: return "";
  }
}

export { parseHash, routeToHash }; // for testing

const HASH_PAGES = new Set(["dashboard", "chat", "book", "book-settings", "book-create", "services", "service-detail", "audit", "analytics", "daemon", "logs", "genres", "style", "import", "radar", "doctor", "automation", "cover-config"]);

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    // 先同步 React state：无论目标页面是否写 URL，保证页面立刻切换。
    // 之前只在非 hash 页面才 setRouteState，hash 页面完全靠 hashchange 事件回调触发。
    // 但当 URL 没有实际变化时（比如从 services → logs → services，中间的 logs
    // 不写 URL，URL 一直停在 #/services），再次赋值同一个 hash 不会触发 hashchange，
    // React state 就永远停留在 logs，表现为"点不动"。
    setRouteState(newRoute);
    if (HASH_PAGES.has(newRoute.page)) {
      const hash = routeToHash(newRoute);
      if (hash && window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }
  }, []);

  const nav = {
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
  };

  return { route, setRoute, nav };
}
