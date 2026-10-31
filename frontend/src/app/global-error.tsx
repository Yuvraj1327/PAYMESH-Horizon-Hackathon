"use client";

/** Last-resort boundary for errors in the root layout. Renders its own <html>; shows no technical details. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#F8FAFC", color: "#0F172A", margin: 0 }}>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, color: "#142B4A", margin: 0 }}>PayMesh hit a problem</h1>
          <p style={{ maxWidth: 420, margin: 0, color: "#475569" }}>An unexpected error occurred. Nothing was submitted or paid. Reload to continue.</p>
          <button onClick={reset} style={{ background: "#2563EB", color: "#fff", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 15, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
