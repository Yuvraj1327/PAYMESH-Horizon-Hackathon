"use client";

import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Tag input: Enter or comma adds a capability; chips are removable. Validation lives in the shared Zod schema. */
export function CapabilityInput({ id, value, onChange, suggestions = [], invalid, describedBy }: {
  id: string; value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; invalid?: boolean; describedBy?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/,+$/, "");
    if (v.length >= 2 && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v.slice(0, 40)]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
    else if (e.key === "Backspace" && draft === "" && value.length) onChange(value.slice(0, -1));
  };
  const open = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase())).slice(0, 5);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="e.g. Market research — press Enter to add" aria-invalid={invalid || undefined} aria-describedby={describedBy} maxLength={40} />
        <Button type="button" variant="outline" onClick={() => add(draft)} disabled={draft.trim().length < 2} aria-label="Add capability"><Plus /></Button>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Required capabilities">
          {value.map((c) => (
            <li key={c}>
              <Badge variant="brand" className="gap-1.5 pr-1">
                {c}
                <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="rounded-full p-0.5 hover:bg-brand/10"><X className="size-3" /></button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Suggestions:</span>
          {open.map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-full border px-2.5 py-0.5 hover:bg-muted">{s}</button>)}
        </div>
      )}
    </div>
  );
}
