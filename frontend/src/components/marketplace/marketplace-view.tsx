"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchX, Search, X } from "lucide-react";
import { AgentCard } from "@/components/marketplace/agent-card";
import { AgentGridSkeleton } from "@/components/marketplace/agent-grid-skeleton";
import { DemoNotice } from "@/components/common/data-source-notice";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CATEGORY_IDS, SELECTABLE_CATEGORIES } from "@/constants/categories";
import { useAgents } from "@/hooks/use-marketplace";
import { useOptimisticValue } from "@/hooks/use-optimistic-value";
import { cn } from "@/lib/utils";
import type { AgentFilters, AgentSort, CategoryId } from "@/types/agent";

const SORTS: ReadonlyArray<{ value: AgentSort; label: string }> = [
  { value: "rating_desc", label: "Rating: high to low" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "availability", label: "Availability" },
];

function parseFilters(p: URLSearchParams): Required<Pick<AgentFilters, "q" | "category" | "sort" | "verifiedOnly" | "availableOnly">> {
  const cat = p.get("category");
  const sort = p.get("sort");
  return {
    q: (p.get("q") ?? "").slice(0, 100),
    category: cat && (CATEGORY_IDS as string[]).includes(cat) ? (cat as CategoryId) : "all",
    sort: SORTS.some((s) => s.value === sort) ? (sort as AgentSort) : "rating_desc",
    verifiedOnly: p.get("verified") === "1",
    availableOnly: p.get("available") === "1",
  };
}

export function MarketplaceView() {
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  // Controls reflect the user's choice instantly; the URL (source of truth) catches up a moment later.
  const [text, setText] = useOptimisticValue(filters.q);
  const [category, setCategory] = useOptimisticValue<CategoryId | "all">(filters.category);
  const [sort, setSort] = useOptimisticValue<AgentSort>(filters.sort);
  const [verifiedOnly, setVerified] = useOptimisticValue(filters.verifiedOnly);
  const [availableOnly, setAvailable] = useOptimisticValue(filters.availableOnly);

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    const qs = next.toString();
    // history.replaceState is integrated with useSearchParams by Next.js and applies immediately, so controlled
    // filter inputs never flicker back to a stale value while a router transition is in flight.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname]);

  // Debounce typing into the URL.
  useEffect(() => {
    if (text.trim() === filters.q) return;
    const t = setTimeout(() => update({ q: text.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [text, filters.q, update]);

  const { data, isPending, isError, error, refetch, isFetching } = useAgents(filters);
  const active = filters.q !== "" || filters.category !== "all" || filters.verifiedOnly || filters.availableOnly;
  const clear = () => { setText(""); setCategory("all"); setSort("rating_desc"); setVerified(false); setAvailable(false); window.history.replaceState(null, "", pathname); };

  return (
    <div className="flex flex-col gap-5">
      <DemoNotice>
        <strong className="font-semibold">Demo listings.</strong> These agents, ratings and reviews are illustrative. None is registered on-chain and none has a payout wallet; on-chain registration status is shown on every card.
      </DemoNotice>

      <div className="flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form role="search" className="relative flex-1" onSubmit={(e) => { e.preventDefault(); update({ q: text.trim() || null }); }}>
            <label htmlFor="agent-search" className="sr-only">Search agents by name, service or capability</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="agent-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, service or capability…" className="pl-9" maxLength={100} />
          </form>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full min-w-44 sm:w-56">
              <label htmlFor="agent-sort" className="sr-only">Sort agents</label>
              <Select id="agent-sort" value={sort} onChange={(e) => { const v = e.target.value as AgentSort; setSort(v); update({ sort: v === "rating_desc" ? null : v }); }}>
                {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand" checked={verifiedOnly} onChange={(e) => { setVerified(e.target.checked); update({ verified: e.target.checked ? "1" : null }); }} />
              Verified listings
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand" checked={availableOnly} onChange={(e) => { setAvailable(e.target.checked); update({ available: e.target.checked ? "1" : null }); }} />
              Available now
            </label>
          </div>
        </div>
        <div role="group" aria-label="Filter by category" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ id: "all" as const, label: "All categories" }, ...SELECTABLE_CATEGORIES].map((c) => {
            const selected = category === c.id;
            return (
              <button
                key={c.id} type="button" aria-pressed={selected}
                onClick={() => { setCategory(c.id); update({ category: c.id === "all" ? null : c.id }); }}
                className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", selected ? "border-navy bg-navy text-white" : "bg-surface text-foreground hover:bg-muted")}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground" aria-live="polite">
        <p>{isPending ? "Loading agents…" : `${data?.length ?? 0} agent${data?.length === 1 ? "" : "s"}${active ? " match your filters" : ""}`}{isFetching && !isPending ? " · updating…" : ""}</p>
        {active && <Button variant="ghost" size="sm" onClick={clear}><X /> Clear filters</Button>}
      </div>

      {isPending ? <AgentGridSkeleton />
        : isError ? <ErrorState title="Couldn’t load the marketplace" message={error.message} onRetry={() => void refetch()} />
        : data.length === 0 ? (
          <EmptyState icon={SearchX} title="No agents match your filters" description="Try a different search term, category or clear the filters."
            action={<Button variant="outline" onClick={clear}>Clear filters</Button>} className="rounded-xl border bg-surface" />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((a) => <li key={a.id} className="relative"><AgentCard agent={a} /></li>)}
          </ul>
        )}
    </div>
  );
}
