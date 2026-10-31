"""Manual end-to-end check against the REAL HSP QA gateway (testnet). Needs your merchant credentials.

    # 1. see exactly what would be sent (no network)
    python -m app.scripts.hsp_qa_order create --pay-to 0xYourTestRecipient --amount 0.01 --dry-run
    # 2. register a real order on QA; no funds move until a wallet pays at payment_url
    python -m app.scripts.hsp_qa_order create --pay-to 0xYourTestRecipient --amount 0.01
    # 3. pay it in the browser with a testnet wallet (HashKey Testnet, chain 133), then watch + independently verify
    python -m app.scripts.hsp_qa_order watch --payment-request-id PMR-QA-... --pay-to 0xYourTestRecipient --amount 0.01

Required env (same names as the backend): HSP_BASE_URL (https://merchant-qa.hashkeymerchant.com), HSP_APP_KEY,
HSP_APP_SECRET, HSP_MERCHANT_PRIVATE_KEY_FILE|PEM, HSK_CHAIN_ID=133, HSK_RPC_URL=https://testnet.hsk.xyz.
`watch` runs the SAME verifier as production (gateway record + on-chain evidence) and prints every check.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import timedelta
from decimal import Decimal

from app.core.config import get_settings
from app.integrations.blockchain.client import ChainClient
from app.integrations.hsp.gateway import HSPGateway
from app.integrations.hsp.mandate import build_order_request, payment_request_id_for
from app.integrations.hsp.schemas import STATUS_RANK
from app.integrations.hsp.tokens import find_token
from app.integrations.hsp.verification import verify_settlement
from app.schemas.common import validate_eth_address
from app.utils.common import utcnow


def _snapshot(args: argparse.Namespace, chain_id: int) -> dict:
    return {"amount": str(Decimal(args.amount)), "asset": args.asset.upper(), "chain_id": chain_id,
            "recipient": validate_eth_address(args.pay_to), "provider_name": "PayMesh QA"}


async def cmd_create(args: argparse.Namespace) -> int:
    s = get_settings()
    snap = _snapshot(args, s.HSK_CHAIN_ID)
    intent_id = uuid.uuid4()
    body, meta = build_order_request(snap, intent_id, s, cart_expiry=utcnow() + timedelta(minutes=args.minutes))
    print("environment :", s.HSP_BASE_URL, "| chain", s.HSK_CHAIN_ID, "| mismatch:", s.hsp_environment_error())
    print("cart_hash   :", meta["cart_hash"])
    print("cart        :", json.dumps(meta["contents"], indent=2))
    if args.dry_run:
        print("\n[dry-run] nothing was sent.")
        return 0
    if s.hsp_environment_error():
        print("REFUSING:", s.hsp_environment_error())
        return 2
    gw = HSPGateway(s)
    try:
        res = await gw.create_order(body["cart_mandate"], body.get("redirect_url"))
    finally:
        await gw.aclose()
    print("\nORDER CREATED")
    print("  payment_request_id:", res.payment_request_id)
    print("  payment_url       :", res.payment_url)
    print("\nPay it with a testnet wallet, then run:")
    print(f"  python -m app.scripts.hsp_qa_order watch --payment-request-id {res.payment_request_id} "
          f"--pay-to {snap['recipient']} --amount {args.amount} --asset {snap['asset']}")
    assert res.payment_request_id == payment_request_id_for(intent_id)
    return 0


async def cmd_watch(args: argparse.Namespace) -> int:
    s = get_settings()
    snap = _snapshot(args, s.HSK_CHAIN_ID)
    token = find_token(s.HSK_CHAIN_ID, snap["asset"])
    if token is None:
        print("unsupported token for this chain")
        return 2
    gw, chain = HSPGateway(s), ChainClient(s)
    try:
        for _ in range(args.max_polls):
            rec = await gw.get_payment(payment_request_id=args.payment_request_id)
            print(f"[{utcnow():%H:%M:%S}] gateway status:", rec.status if rec else "(no payer activity yet)",
                  "| tx:", getattr(rec, "tx_signature", None))
            if rec and (rec.status == "payment-failed"):
                print("payment failed:", rec.status_reason)
                return 1
            if rec and STATUS_RANK.get(rec.status, -1) >= STATUS_RANK[s.HSP_SETTLEMENT_MIN_STATUS]:
                res = await verify_settlement(
                    settings=s, chain=chain, record=rec, token=token, snapshot=snap,
                    cart_mandate_id=rec.content_id or "", payment_request_id=args.payment_request_id,
                    buyer_wallet=args.payer, tx_already_used_elsewhere=False)
                for c in res.checks:
                    print(("  PASS " if c.ok else "  FAIL "), c.name, "| expected:", c.expected, "| actual:", c.actual)
                print("\nVERIFIED SETTLEMENT" if res.ok else "\nVERIFICATION FAILED")
                print("tx:", res.tx_hash, "| block:", res.block_number, "| amount:", res.verified_amount)
                return 0 if res.ok else 1
            await asyncio.sleep(args.interval)
    finally:
        await gw.aclose()
    print("timed out waiting for the minimum settlement status")
    return 3


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("create", "watch"):
        sp = sub.add_parser(name)
        sp.add_argument("--pay-to", required=True)
        sp.add_argument("--amount", required=True)
        sp.add_argument("--asset", default="USDT")
    c = sub.choices["create"]
    c.add_argument("--minutes", type=int, default=60)
    c.add_argument("--dry-run", action="store_true")
    w = sub.choices["watch"]
    w.add_argument("--payment-request-id", required=True)
    w.add_argument("--payer", default=None, help="expected payer wallet (optional binding check)")
    w.add_argument("--interval", type=int, default=10)
    w.add_argument("--max-polls", type=int, default=180)
    args = p.parse_args()
    return asyncio.run(cmd_create(args) if args.cmd == "create" else cmd_watch(args))


if __name__ == "__main__":
    sys.exit(main())
