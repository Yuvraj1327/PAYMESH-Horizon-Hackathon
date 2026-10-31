"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the console for debugging only; never log payment or auth payloads.
    console.error("Route error:", error.digest ?? error.message);
  }, [error]);
  return <ErrorState title="This page hit a problem" message="An unexpected error occurred. Your data was not changed." onRetry={reset} />;
}
