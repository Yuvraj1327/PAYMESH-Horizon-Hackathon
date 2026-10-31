import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/common/copy-button";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/web3/chains";
import { shortAddress, shortHash } from "@/lib/web3/address";

/** Shortened address/hash with copy and (only when a verified explorer URL is configured) an explorer link. */
export function AddressText({ value, chainId, kind = "address", empty = "—" }: { value: string | null | undefined; chainId?: number; kind?: "address" | "tx"; empty?: string }) {
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  const href = chainId == null ? null : kind === "tx" ? explorerTxUrl(chainId, value) : explorerAddressUrl(chainId, value);
  return (
    <span className="inline-flex items-center gap-0.5">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" title={value}>{kind === "tx" ? shortHash(value) : shortAddress(value)}</code>
      <CopyButton value={value} label={kind === "tx" ? "Copy transaction hash" : "Copy address"} />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label="View on block explorer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      )}
    </span>
  );
}
