"""Independent settlement verification.

A payment is only "settled" when ALL of these hold -- a 2xx from HSP, a webhook body, or a tx hash alone is never enough:

  Gateway (fresh authoritative query, not the webhook body)
    * status is at/after the configured minimum (default payment-finalized)
    * the record belongs to THIS order (payment_request_id / cart id)
    * payee, chain (CAIP-2), token symbol + official token address, and amount match the intent's immutable snapshot
    * payer matches the buyer's registered wallet (when the buyer registered one)
  Chain (our own RPC, independent of HSP)
    * the tx exists, succeeded, is finalized (or has >= N confirmations)
    * an ERC-20 Transfer(token, payer -> payee) of at least the order amount was emitted
  Replay
    * the tx hash has never been attributed to any other payment

Every check is recorded (name, ok, expected, actual) in the receipt's `verification_details`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from app.core.config import Settings
from app.integrations.blockchain.client import ChainClient, TxEvidence
from app.integrations.hsp.schemas import STATUS_RANK, HSPPaymentRecord
from app.integrations.hsp.tokens import HSPToken

_TX_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


@dataclass
class Check:
    name: str
    ok: bool
    expected: Any = None
    actual: Any = None
    note: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "ok": self.ok, "expected": _s(self.expected), "actual": _s(self.actual), "note": self.note}


def _s(v: Any) -> Any:
    return v if v is None or isinstance(v, (bool, int, str)) else str(v)


@dataclass
class VerificationResult:
    ok: bool
    checks: list[Check] = field(default_factory=list)
    tx_hash: str | None = None
    verified_amount: Decimal | None = None
    block_number: int | None = None

    @property
    def failed(self) -> list[Check]:
        return [c for c in self.checks if not c.ok]

    def details(self) -> dict[str, Any]:
        return {"ok": self.ok, "checks": [c.as_dict() for c in self.checks]}


def _dec(v: str | None) -> Decimal | None:
    try:
        return Decimal(v) if v not in (None, "") else None
    except InvalidOperation:
        return None


def _same_addr(a: str | None, b: str | None) -> bool:
    return bool(a and b and a.lower() == b.lower())


async def verify_settlement(
    *,
    settings: Settings,
    chain: ChainClient,
    record: HSPPaymentRecord,
    token: HSPToken,
    snapshot: dict[str, Any],
    cart_mandate_id: str,
    payment_request_id: str,
    buyer_wallet: str | None,
    tx_already_used_elsewhere: bool,
) -> VerificationResult:
    s = settings
    cs: list[Check] = []

    def add(name: str, ok: bool, expected: Any = None, actual: Any = None, note: str | None = None) -> bool:
        cs.append(Check(name, bool(ok), expected, actual, note))
        return bool(ok)

    # ---- gateway-side ---------------------------------------------------------------------------------
    min_rank = STATUS_RANK[s.HSP_SETTLEMENT_MIN_STATUS]
    rank = STATUS_RANK.get(record.status, -1)
    add("gateway_status", rank >= min_rank, f">= {s.HSP_SETTLEMENT_MIN_STATUS}", record.status)
    add("order_reference", record.payment_request_id == payment_request_id and
        (record.content_id in (None, cart_mandate_id)), payment_request_id, record.payment_request_id)
    add("recipient", _same_addr(record.to_pay_address, snapshot["recipient"]), snapshot["recipient"], record.to_pay_address)
    add("chain", record.chain == token.caip2 and (record.network in (None, token.network)), token.caip2, record.chain)
    add("token", (record.token or "").upper() == token.symbol and _same_addr(record.token_address, token.address),
        f"{token.symbol} {token.address}", f"{record.token} {record.token_address}")

    expected_usd = Decimal(str(snapshot["amount"]))
    rate = _dec(record.usd_amount_rate) or Decimal(1)
    add("stablecoin_rate_sane", Decimal("0.95") <= rate <= Decimal("1.05"), "0.95..1.05", str(rate))
    expected_token_amount = expected_usd / rate if rate > 0 else expected_usd
    order_amount = _dec(record.order_amount) or _dec(record.product_amount)
    tol = Decimal(s.HSP_AMOUNT_SHORTFALL_BPS) / Decimal(10_000)
    amount_ok = order_amount is not None and abs(order_amount - expected_token_amount) <= expected_token_amount * tol
    add("order_amount", amount_ok, str(expected_token_amount), record.order_amount or record.product_amount,
        "token-denominated; order must equal the intent amount (no add-on charges are used by PayMesh)")

    if buyer_wallet:
        add("payer_is_registered_buyer_wallet", _same_addr(record.payer_address, buyer_wallet), buyer_wallet, record.payer_address)
    else:
        add("payer_present", bool(record.payer_address), "payer address", record.payer_address,
            "buyer has no registered wallet; payer recorded but not bound to the buyer")

    tx = record.tx_signature
    add("tx_hash_present", bool(tx and _TX_RE.match(tx)), "0x + 64 hex", tx)
    add("tx_hash_not_reused", not tx_already_used_elsewhere, "unused", "reused" if tx_already_used_elsewhere else "unused")

    # ---- chain-side -----------------------------------------------------------------------------------------
    verified_amount: Decimal | None = None
    block_number: int | None = None
    mode = s.HSP_ONCHAIN_CHECK if not s.is_production else "strict"   # 'off'/'tx_only' are never allowed in production
    if mode != "off":
        add("rpc_chain_matches_intent", s.HSK_CHAIN_ID == token.chain_id, token.chain_id, s.HSK_CHAIN_ID)
        evidence: TxEvidence | None = None
        if tx and _TX_RE.match(tx) and s.HSK_CHAIN_ID == token.chain_id:
            evidence = await chain.get_tx_evidence(tx)
        add("onchain_tx_found", evidence is not None, "tx on chain", "found" if evidence else "not found")
        if evidence is not None:
            block_number = evidence.block_number
            add("onchain_tx_success", evidence.success, "status=1", "success" if evidence.success else "reverted")
            final_ok = evidence.finalized is True or (evidence.finalized is None and evidence.confirmations >= s.HSP_MIN_CONFIRMATIONS)
            add("onchain_finality", final_ok, "finalized or >= %d confirmations" % s.HSP_MIN_CONFIRMATIONS,
                f"finalized={evidence.finalized} confirmations={evidence.confirmations}")
            if mode == "strict":
                units = token.to_units(expected_token_amount)
                need = units - (units * s.HSP_AMOUNT_SHORTFALL_BPS) // 10_000
                got = sum(
                    t.value for t in evidence.transfers
                    if _same_addr(t.token, token.address) and _same_addr(t.recipient, snapshot["recipient"])
                    and (not record.payer_address or _same_addr(t.sender, record.payer_address))
                )
                add("onchain_transfer_to_recipient", got >= need and got > 0, f">= {need} units of {token.symbol}", f"{got} units",
                    "ERC-20 Transfer(payer -> payee) emitted by the official token contract")
                verified_amount = Decimal(got) / (Decimal(10) ** token.decimals)

    ok = all(c.ok for c in cs)
    return VerificationResult(ok=ok, checks=cs, tx_hash=tx, verified_amount=verified_amount, block_number=block_number)
