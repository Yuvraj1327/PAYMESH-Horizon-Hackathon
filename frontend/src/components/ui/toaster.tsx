"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "success" | "error" | "info";
interface Toast { id: number; title: string; description?: string; variant: Variant }
interface ToastApi { push(t: { title: string; description?: string; variant?: Variant }): void }

const ToastContext = createContext<ToastApi | null>(null);
const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const TONE = { success: "border-success/40 text-success", error: "border-danger/40 text-danger", info: "border-brand/40 text-info" } as const;

/** Lightweight toasts: polite live region, auto-dismiss, keyboard-dismissable. Never carries sensitive data. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<ToastApi["push"]>((t) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-3), { id, title: t.title, description: t.description, variant: t.variant ?? "info" }]);
    setTimeout(() => dismiss(id), t.variant === "error" ? 8000 : 4500);
  }, [dismiss]);
  const api = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96" data-testid="toaster">
        {items.map((t) => {
          const Icon = ICON[t.variant];
          return (
            <div key={t.id} role={t.variant === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-surface p-3 shadow-pop", TONE[t.variant])} data-testid="toast">
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{t.title}</p>{t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}</div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" aria-hidden="true" /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
