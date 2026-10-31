import Link from "next/link";
import { CheckCircle2, Circle, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/types/dashboard";

/** The core PayMesh workflow as a checklist. Ticks come from your real requests and payments, never from clicks. */
export function Walkthrough({ data }: { data: DashboardData }) {
  const p = data.progress;
  const latest = p.latestRequestId;
  const steps: { label: string; detail: string; href: string; done: boolean }[] = [
    { label: "Start from the dashboard", detail: "You are here.", href: "/dashboard", done: true },
    { label: "Create a crypto research request", detail: "Pre-filled: a market research brief, 1 USDT budget.", href: "/procurement/new?preset=research", done: p.hasRequest },
    { label: "Discover three provider agents", detail: "Matching providers respond with quotations.", href: latest ? `/procurement/${latest}/quotations` : "/procurement/new?preset=research", done: p.maxQuotes >= 3 },
    { label: "Compare quotations", detail: "Price, delivery and reputation side by side.", href: latest ? `/procurement/${latest}/quotations` : "/procurement", done: p.maxQuotes >= 2 },
    { label: "Select a provider", detail: "Your explicit choice; nothing is paid yet.", href: latest ? `/procurement/${latest}/quotations` : "/procurement", done: p.selected },
    { label: "Review payment conditions", detail: "Frozen terms: recipient, amount, asset, network.", href: latest ? `/procurement/${latest}/pay` : "/procurement", done: p.hasPayment },
    { label: "See Payment Guardian validation", detail: "Spending-policy checks from the backend.", href: latest ? `/procurement/${latest}/pay` : "/procurement", done: p.hasPayment },
    { label: "Authorize with your wallet", detail: "MetaMask signs in the HSP checkout, on HashKey Testnet.", href: latest ? `/procurement/${latest}/pay` : "/procurement", done: p.authorized },
    { label: "Follow HSP settlement status", detail: "Gateway progress, then backend verification.", href: "/payments", done: p.authorized },
    { label: "View the verified receipt", detail: "Issued only after settlement is verified.", href: "/transactions", done: p.settled },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card data-testid="walkthrough">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2"><Route className="size-5 text-brand" aria-hidden="true" /><CardTitle>Guided walkthrough</CardTitle>{data.source === "demo" && <Badge variant="demo">Demo mode</Badge>}<span className="ml-auto text-xs text-muted-foreground">{done}/{steps.length}</span></div>
        <CardDescription>AI agents need a trusted way to discover services and pay each other. PayMesh connects procurement, payment authorization and verified settlement.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-1" aria-label="Walkthrough steps">
          {steps.map((s, i) => (
            <li key={s.label}>
              <Link href={s.href} className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" data-done={s.done}>
                {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />}
                <span className="min-w-0"><span className="block text-sm font-medium">{i + 1}. {s.label}</span><span className="block text-xs text-muted-foreground">{s.detail}</span></span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">{data.source === "demo" ? "Demo mode: the flow runs on labelled sample data and stops before HSP; no wallet signature is requested and nothing is paid." : "Wallet steps run on the network configured for this deployment. Mainnet payments need your explicit approval."}</p>
      </CardContent>
    </Card>
  );
}
