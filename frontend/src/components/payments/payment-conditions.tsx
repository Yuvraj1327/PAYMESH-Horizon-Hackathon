import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressText } from "@/components/common/address-text";
import { formatDateTime } from "@/components/common/format";
import { formatTokenAmount } from "@/lib/decimal";
import { chainLabel } from "@/lib/web3/chains";
import { shortHash } from "@/lib/web3/address";
import type { PaymentRecord } from "@/types/payment";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="min-w-0 text-sm font-medium text-foreground">{children}</dd></div>;
}

/** The conditions exactly as the backend froze them. Nothing here is editable. */
export function PaymentConditions({ p, title = "Payment conditions", description = "These terms were frozen by the backend and cannot be changed after you approve." }: { p: PaymentRecord; title?: string; description?: string }) {
  return (
    <Card data-testid="payment-conditions">
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">
          <Row label="Provider">{p.providerName}</Row>
          <Row label="Recipient">{p.recipient ? <AddressText value={p.recipient} chainId={p.chainId} /> : <span className="text-muted-foreground">Not available in demo (demo agents have no wallet)</span>}</Row>
          <Row label="Amount"><span className="text-lg font-bold text-navy" data-testid="cond-amount">{formatTokenAmount(p.amount)}</span></Row>
          <Row label="Asset">{p.asset}</Row>
          <Row label="Network">{chainLabel(p.chainId)}</Row>
          <Row label="Authorization window ends">{formatDateTime(p.expiresAt)}</Row>
          {p.snapshotHash && <Row label="Conditions fingerprint"><code className="font-mono text-xs" title={p.snapshotHash}>{shortHash(p.snapshotHash)}</code></Row>}
        </dl>
      </CardContent>
    </Card>
  );
}
