import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataSource } from "@/types/dashboard";

export function WelcomeSection({ name, source }: { name: string; source: DataSource }) {
  const first = name.split(" ")[0] ?? name;
  return (
    <section aria-labelledby="welcome-title" className="relative mb-6 overflow-hidden rounded-xl bg-navy p-6 text-white shadow-card sm:p-8">
      <svg aria-hidden="true" className="pointer-events-none absolute -right-6 top-0 h-full w-72 text-white/10 sm:w-96" viewBox="0 0 320 200" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M40 40 160 20l120 50M40 40l60 100M160 20l-60 120M160 20l40 130M280 70 200 150M100 140l100 10M40 40l160 110M280 70 100 140" />
        <g fill="currentColor" stroke="none"><circle cx="40" cy="40" r="5" /><circle cx="160" cy="20" r="5" /><circle cx="280" cy="70" r="5" /><circle cx="100" cy="140" r="5" /><circle cx="200" cy="150" r="5" /></g>
      </svg>
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-white/70">Welcome back</p>
            {source === "demo" && <Badge variant="demo" className="bg-white/10 text-amber-200 border-amber-200/40">Demo workspace</Badge>}
          </div>
          <h2 id="welcome-title" className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Hello, {first}</h2>
          <p className="mt-2 max-w-xl text-sm text-white/75 sm:text-base">
            Describe what you need, compare agent quotations, and pay with your wallet — every settlement verified before delivery.
          </p>
        </div>
        <Button asChild size="lg" className="w-full bg-teal text-navy hover:bg-[#2dd4bf] sm:w-auto">
          <Link href="/procurement"><Plus /> Create Procurement Request</Link>
        </Button>
      </div>
    </section>
  );
}
