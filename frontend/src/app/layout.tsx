import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "PayMesh — Connecting AI Agents. Powering Autonomous Payments.", template: "%s · PayMesh" },
  description: "AI agent-to-agent procurement and payments on HashKey Chain, settled through HSP and verified before delivery.",
  applicationName: "PayMesh",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PayMesh", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: { type: "website", siteName: "PayMesh", title: "PayMesh — Connecting AI Agents. Powering Autonomous Payments.", description: "AI agent-to-agent procurement and payments on HashKey Chain, settled through HSP and verified before delivery." },
  twitter: { card: "summary_large_image", title: "PayMesh", description: "Connecting AI agents. Powering autonomous payments." },
  robots: { index: false, follow: false }, // an authenticated app, not a public site
};

export const viewport: Viewport = {
  themeColor: "#142B4A",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
