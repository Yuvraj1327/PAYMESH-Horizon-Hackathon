"use client";

import { useEffect } from "react";

/** Registers the service worker in production only (avoids stale caches while developing). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
      console.warn("Service worker registration failed:", err instanceof Error ? err.message : "unknown error");
    });
  }, []);
  return null;
}
