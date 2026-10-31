"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Registers the service worker (production only) and offers a user-controlled update: a new version waits until the
 * user taps "Update", so the app is never swapped mid-payment. The worker caches static assets only (see public/sw.js).
 */
export function RegisterServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    const onControllerChange = () => { if (!reloading) { reloading = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
      timer = setInterval(() => { void reg.update().catch(() => undefined); }, 60 * 60 * 1000);
    }).catch((err: unknown) => {
      console.warn("Service worker registration failed:", err instanceof Error ? err.message : "unknown error");
    });
    return () => { navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange); if (timer) clearInterval(timer); };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" data-testid="update-banner" className="fixed inset-x-3 bottom-3 z-[70] flex items-center gap-3 rounded-lg border border-brand/40 bg-surface p-3 shadow-pop sm:left-auto sm:right-4 sm:w-96">
      <RefreshCw className="size-5 shrink-0 text-brand" aria-hidden="true" />
      <p className="flex-1 text-sm">A new version of PayMesh is ready.</p>
      <Button size="sm" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Update</Button>
    </div>
  );
}
