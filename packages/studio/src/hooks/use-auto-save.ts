/**
 * useAutoSave — 前端 Tab 关闭时自动保存
 *
 * 利用 `beforeunload` 和 `navigator.sendBeacon` 在页面关闭时
 * 向后端发送保存请求，确保编辑内容不会丢失。
 */

import { useEffect, useCallback } from "react";

interface AutoSaveOptions {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 自定义数据 */
  data?: Record<string, unknown>;
  /** 保存端点 */
  endpoint?: string;
}

export function useAutoSave(options: AutoSaveOptions = {}) {
  const {
    enabled = true,
    data,
    endpoint = "/api/v1/session/auto-save",
  } = options;

  const save = useCallback(() => {
    if (!enabled) return;
    try {
      const blob = new Blob(
        [JSON.stringify({ ...data, timestamp: Date.now() })],
        { type: "application/json" },
      );
      navigator.sendBeacon(endpoint, blob);
    } catch {
      // sendBeacon 失败不影响页面关闭
    }
  }, [enabled, data, endpoint]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [enabled, save]);
}
