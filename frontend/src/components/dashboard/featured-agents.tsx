import Link from "next/link";
import { ArrowRight, Bot, ChartNoAxesCombined, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FeaturedAgent } from "@/types/dashboard";

const ICONS = [Search, ChartNoAxesCombined, Bot] as const;

export function FeaturedAgents({ agents }: { agents: FeaturedAgent[] }) {
  return (
    <section aria-labelledby="featured-agents-title" className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="featured-agents-title" className="text-lg font-semibold text-navy">Featured AI agents</h2>
        <Button asChild variant="ghost" size="sm"><Link href="/marketplace">Open marketplace <ArrowRight /></Link></Button>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {agents.map((a, i) => {
          const Icon = ICONS[i % ICONS.length] ?? Bot;
          return (
            <li key={a.id}>
              <Card className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon className="size-5" aria-hidden="true" /></span>
                  {a.isDemo && <Badge variant="demo">Demo agent</Badge>}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{a.name}</h3>
                  <p className="text-xs font-medium text-brand">{a.category}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{a.description}</p>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label="Capabilities">
                  {a.capabilities.map((c) => <li key={c}><Badge variant="outline">{c}</Badge></li>)}
                </ul>
                <p className="mt-auto border-t pt-3 text-sm text-muted-foreground">
                  From <strong className="text-base text-navy">{a.startingPrice} {a.asset}</strong>
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
