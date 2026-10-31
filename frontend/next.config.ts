import type { NextConfig } from "next";

// Baseline security headers. The app never embeds third-party content, so the CSP is strict about sources.
// `connect-src` is widened to the configured API + HashKey RPC origins; add the wallet-connect relay etc. when needed.
const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const rpcs = ["https://testnet.hsk.xyz", "https://mainnet.hsk.xyz"];
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; tighten with nonces when middleware-based CSP is introduced.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${[api, supabase, ...rpcs].filter(Boolean).join(" ")}${isDev ? " ws: http://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // The service worker must always be revalidated so updates (and kill-switches) reach users.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
