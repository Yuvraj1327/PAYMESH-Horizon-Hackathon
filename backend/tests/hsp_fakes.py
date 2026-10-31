"""Test doubles for HSP and the chain.

FakeHSP is NOT evidence that the real gateway works. It is a strict re-implementation of the *documented*
server-side checks (docs/en/authentication.md, api-reference.md, cart-mandate.md @ 8460bdd) written independently
of the application code, so the client has to satisfy the written spec rather than merely agree with itself.
Real-gateway verification requires QA credentials (see HSP_INTEGRATION.md, tests/test_hsp_live_qa.py).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import jwt

from app.integrations.blockchain.client import TokenTransfer, TxEvidence

OFFICIAL_USDT_133 = "0x372325443233fEbaC1F6998aC750276468c83CC6"


def canon(v):  # noqa: ANN001, ANN201
    """Independent canonical JSON: recursive key sort + compact separators."""
    def srt(x):  # noqa: ANN001, ANN202
        if isinstance(x, dict):
            return {k: srt(x[k]) for k in sorted(x)}
        if isinstance(x, list):
            return [srt(i) for i in x]
        return x
    return json.dumps(srt(v), separators=(",", ":"), ensure_ascii=False)


def env(code: int, msg: str = "", data=None, http: int = 200) -> httpx.Response:  # noqa: ANN001
    return httpx.Response(http, json={"code": code, "msg": msg or ("success" if code == 0 else "error"), "data": data})


class FakeHSP:
    def __init__(self, app_key: str, app_secret: str, merchant_public_key) -> None:  # noqa: ANN001
        self.app_key, self.app_secret, self.pub = app_key, app_secret, merchant_public_key
        self.orders: dict[str, dict] = {}
        self.payments: dict[str, dict] = {}
        self.nonces: set[str] = set()
        self.calls: list[tuple[str, str, str]] = []
        self.script: list[str] = []          # one-shot failures consumed by the next request: "503" | "429" | "timeout"
        self.create_script: list[str] = []   # one-shot failures for POST /orders only
        self.skew = 300

    # ---------------------------------------------------------------- auth (docs/en/authentication.md)
    def _auth(self, req: httpx.Request) -> httpx.Response | None:
        h = req.headers
        if h.get("X-App-Key") != self.app_key:
            return env(10002, "unauthorized", http=401)
        try:
            ts = int(h["X-Timestamp"])
        except (KeyError, ValueError):
            return env(10002, "bad timestamp", http=401)
        if abs(time.time() - ts) > self.skew:
            return env(10002, "timestamp skew", http=401)
        nonce = h.get("X-Nonce", "")
        if not nonce or nonce in self.nonces:
            return env(10002, "nonce replay", http=401)
        body = req.content
        body_hash = hashlib.sha256(canon(json.loads(body)).encode()).hexdigest() if body else ""
        if body and body.decode() != canon(json.loads(body)):
            pass  # senders may use any serialization; we hash the canonical form like the docs say
        query = req.url.query.decode() if isinstance(req.url.query, bytes) else req.url.query
        msg = f"{req.method}\n{req.url.path}\n{query}\n{body_hash}\n{ts}\n{nonce}"
        expect = hmac.new(self.app_secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expect, h.get("X-Signature", "")):
            return env(10002, "bad signature", http=401)
        self.nonces.add(nonce)
        return None

    # ---------------------------------------------------------------- handler
    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path, req.url.query.decode()))
        if self.script:
            nxt = self.script.pop(0)
            if nxt == "timeout":
                raise httpx.ReadTimeout("simulated", request=req)
            return httpx.Response(int(nxt), json={"code": 10005 if nxt != "429" else 10007, "msg": "err"})
        if req.method == "POST" and req.url.path == "/api/v1/merchant/orders" and self.create_script:
            nxt = self.create_script.pop(0)
            if nxt == "timeout":
                raise httpx.ReadTimeout("simulated", request=req)
            return httpx.Response(int(nxt), json={"code": 10005, "msg": "err"})
        bad = self._auth(req)
        if bad is not None:
            return bad
        if req.method == "POST" and req.url.path == "/api/v1/merchant/orders":
            return self._create(json.loads(req.content))
        if req.method == "GET" and req.url.path == "/api/v1/merchant/payments":
            return self._query(dict(httpx.QueryParams(req.url.query)))
        return env(10003, "not found", http=404)

    def _create(self, body: dict) -> httpx.Response:
        try:
            cm = body["cart_mandate"]
            c, mauth = cm["contents"], cm["merchant_authorization"]
            assert isinstance(c["id"], str) and c["id"]
            assert c["user_cart_confirmation_required"] in (True, False)
            assert isinstance(c["merchant_name"], str) and c["merchant_name"]
            datetime.fromisoformat(c["cart_expiry"].replace("Z", "+00:00"))
            assert datetime.fromisoformat(c["cart_expiry"].replace("Z", "+00:00")) > datetime.now(UTC)
            md = c["payment_request"]["method_data"]
            assert md, "method_data"
            for m in md:
                assert m["supported_methods"] == "https://www.x402.org/"
                d = m["data"]
                assert d["x402Version"] == 2
                for k in ("network", "chain_id", "contract_address", "pay_to", "coin"):
                    assert d[k] not in (None, "")
                assert isinstance(d["chain_id"], int)
            det = c["payment_request"]["details"]
            assert det["id"]
            tot = Decimal(det["total"]["amount"]["value"])
            assert det["total"]["amount"]["currency"] == "USD"
            items = det.get("display_items") or []
            if items:
                assert sum(Decimal(i["amount"]["value"]) for i in items) == tot
            assert tot > 0
            # --- merchant_authorization: ES256K JWT, aud HashkeyMerchant, cart_hash over canonical contents
            hdr = jwt.get_unverified_header(mauth)
            assert hdr["alg"] == "ES256K" and hdr.get("typ") == "JWT"
            claims = jwt.decode(mauth, self.pub, algorithms=["ES256K"], audience="HashkeyMerchant")
            for k in ("iss", "sub", "aud", "iat", "exp", "jti", "cart_hash"):
                assert k in claims, k
            assert claims["cart_hash"] == hashlib.sha256(canon(c).encode()).hexdigest()
        except jwt.PyJWTError:
            return env(10002, "invalid merchant_authorization", http=401)
        except (AssertionError, KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
            return env(10001, f"invalid parameters: {exc}", http=400)
        if c["id"] in self.orders:
            return env(40001, "invalid mandate state: cart_mandate_id already used", http=400)
        self.orders[c["id"]] = body
        pr = det["id"]
        return env(0, data={"payment_request_id": pr, "payment_url": f"https://pay.example/flow/{len(self.orders)}", "multi_pay": False})

    def _query(self, q: dict) -> httpx.Response:
        if len(q) != 1:
            return env(10001, "exactly one filter", http=400)
        if "payment_request_id" in q:
            rec = self.payments.get(q["payment_request_id"])
            return env(0, data=rec) if rec else env(10003, "not found", http=404)
        return env(10003, "not found", http=404)

    # ---------------------------------------------------------------- scenario driver
    def order_for(self, payment_request_id: str) -> dict:
        for body in self.orders.values():
            if body["cart_mandate"]["contents"]["payment_request"]["details"]["id"] == payment_request_id:
                return body["cart_mandate"]["contents"]
        raise KeyError(payment_request_id)

    def pay(self, payment_request_id: str, status: str, *, tx: str | None = "0x" + "ab" * 32, payer: str | None = None,
            **over) -> dict:  # noqa: ANN003
        """Simulate the payer acting in the hosted checkout, as the gateway would report it."""
        contents = self.order_for(payment_request_id)
        md = contents["payment_request"]["method_data"][0]["data"]
        amount = contents["payment_request"]["details"]["total"]["amount"]["value"]
        rec = {
            "content_id": contents["id"], "payment_request_id": payment_request_id, "request_id": "req_1", "flow_id": "FLOW-" + payment_request_id[-6:],
            "status": status, "token": md["coin"], "token_address": md["contract_address"], "chain": f"eip155:{md['chain_id']}",
            "network": md["network"], "to_pay_address": md["pay_to"], "payer_address": payer, "order_amount": amount,
            "product_amount": amount, "pay_amount": amount, "usd_amount_rate": "1", "usd_product_amount": amount,
            "extra_protocol": "permit2", "tx_signature": tx if STATUS_RANK_HAS_TX.get(status) else None,
            "created_at": "2026-10-31T10:00:00Z", "updated_at": "2026-10-31T10:01:00Z",
        }
        rec.update(over)
        self.payments[payment_request_id] = rec
        return rec


STATUS_RANK_HAS_TX = {"payment-included": True, "payment-safe": True, "payment-finalized": True, "payment-processing": False,
                      "payment-submitted": False, "payment-verified": False, "payment-failed": False, "payment-required": False}


class FakeChain:
    """Stands in for ChainClient (only what the verifier uses)."""

    def __init__(self) -> None:
        self.evidence: dict[str, TxEvidence] = {}
        self.calls: list[str] = []

    async def get_tx_evidence(self, tx_hash: str) -> TxEvidence | None:
        self.calls.append(tx_hash)
        return self.evidence.get(tx_hash)

    def add(self, tx: str, *, token: str, sender: str, recipient: str, units: int, success: bool = True,
            finalized: bool | None = True, confirmations: int = 50, extra: list[TokenTransfer] | None = None) -> TxEvidence:
        ev = TxEvidence(tx_hash=tx, success=success, block_number=1234, confirmations=confirmations, finalized=finalized,
                        transfers=tuple([TokenTransfer(token, sender, recipient, units), *(extra or [])]))
        self.evidence[tx] = ev
        return ev
