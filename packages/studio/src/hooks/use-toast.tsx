/**
 * Lightweight toast notification system — zero new dependencies.
 *
 * Inspired by Sonner's API (https://sonner.emilkowalski.com/) but
 * implemented as a ~100-line React Context + Portal.
 *
 * Usage:
 *   const { addToast } = useToast();
 *   addToast({ type: "success", title: "Saved" });
 */

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";

export interface Toast {
  readonly id: string;
  readonly type: "success" | "error" | "info" | "warning";
  readonly title: string;
  readonly description?: string;
  readonly action?: { label: string; onClick: () => void };
  readonly duration?: number;
}

const ToastCtx = createContext<{
  addToast: (t: Omit<Toast, "id">) => void;
} | null>(null);

const ICON_MAP = {
  success: { icon: CheckCircle2, color: "text-emerald-500" },
  error: { icon: XCircle, color: "text-red-500" },
  info: { icon: Info, color: "text-blue-500" },
  warning: { icon: AlertTriangle, color: "text-amber-500" },
} as const;

const BG_MAP = {
  success: "border-emerald-200 bg-emerald-50",
  error: "border-red-200 bg-red-50",
  info: "border-blue-200 bg-blue-50",
  warning: "border-amber-200 bg-amber-50",
} as const;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { icon: Icon, color } = ICON_MAP[toast.type];
  const bg = BG_MAP[toast.type];

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[300px] max-w-[420px] ${bg} animate-[slideIn_0.2s_ease-out]`}
    >
      <Icon size={18} className={`${color} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
        )}
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="text-xs font-medium text-primary hover:underline mt-1"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button onClick={onDismiss} className="p-0.5 rounded hover:bg-black/5 transition-colors shrink-0">
        <X size={14} className="text-muted-foreground" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toast: Toast = { ...t, id, duration: t.duration ?? 3000 };
    setToasts((prev) => [...prev.slice(-4), toast]);
    const timer = setTimeout(() => removeToast(id), toast.duration);
    timers.current.set(id, timer);
  }, [removeToast]);

  if (typeof document === "undefined") return children;

  return (
    <ToastCtx.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastItem toast={toast} onDismiss={() => removeToast(toast.id)} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
