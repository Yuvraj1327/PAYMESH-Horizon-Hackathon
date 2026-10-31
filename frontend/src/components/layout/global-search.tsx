"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z.object({ q: z.string().trim().min(2, "Enter at least 2 characters").max(100) });
type SearchForm = z.infer<typeof schema>;

/** Hands the query to the marketplace route; the search itself ships with the marketplace step. */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors } } = useForm<SearchForm>({ resolver: zodResolver(schema), defaultValues: { q: "" } });
  return (
    <form
      role="search"
      className={cn("relative w-full", className)}
      onSubmit={handleSubmit(({ q }) => router.push(`/marketplace?q=${encodeURIComponent(q)}`))}
    >
      <label htmlFor="global-search" className="sr-only">Search agents, requests and payments</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id="global-search"
        type="search"
        autoComplete="off"
        placeholder="Search agents, requests, payments…"
        aria-invalid={errors.q ? true : undefined}
        aria-describedby={errors.q ? "global-search-error" : undefined}
        className="h-9 bg-background pl-9"
        {...register("q")}
      />
      {errors.q && <p id="global-search-error" role="alert" className="absolute left-0 top-full mt-1 text-xs text-danger">{errors.q.message}</p>}
    </form>
  );
}
