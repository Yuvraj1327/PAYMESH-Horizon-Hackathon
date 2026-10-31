"""HSP authentication, Cart Mandate preparation, gateway client behaviour, webhook verification."""

from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import jwt
import pytest

from app.core.config import get_settings
from app.core.errors import UnprocessableError
from app.integrations.hsp import authentication as auth
from app.integrations.hsp.exceptions import (
    HSPAmbiguousOutcomeError,
    HSPApiError,
    HSPAuthError,
    HSPNotConfiguredError,
    HSPProtocolError,
    HSPUnavailableError,
    HSPWebhookError,
)
from app.integrations.hsp.gateway import HSPGateway
from app.integrations.hsp.mandate import (
    build_cart_contents,
    build_order_request,
    cart_mandate_id_for,
    payment_request_id_for,
    validate_amount_rules,
)
from app.integrations.hsp.tokens import all_tokens, find_token
from app.integrations.hsp.webhooks import sign_webhook, verify_webhook
from tests.conftest import MERCHANT_KEY
from tests.hsp_fakes import OFFICIAL_USDT_133, FakeHSP, canon

S = get_settings()
RECIPIENT = "0x" + "44" * 20
SNAP = {"amount": "0.25", "asset": "USDT", "chain_id": 133, "recipient": RECIPIENT, "provider_name": "Crypto Research Agent (Demo)"}


def expiry(minutes: int = 60) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes)


# ============================================================================ canonical JSON / HMAC
def test_canonical_json_matches_documented_example():
    # docs/en/appendix.md "Canonical JSON" example, verbatim
    obj = {"b": 2, "a": 1, "nested": {"z": "last", "m": "middle"}}
    assert auth.canonical_json(obj) == '{"a":1,"b":2,"nested":{"m":"middle","z":"last"}}'
    # docs/en/cart-mandate.md example
    c = {"merchant_name": "My Store", "id": "cart-123", "cart_expiry": "2024-03-01T12:00:00Z"}
    assert auth.canonical_json(c) == '{"cart_expiry":"2024-03-01T12:00:00Z","id":"cart-123","merchant_name":"My Store"}'
    assert auth.canonical_json([{"b": 1, "a": 2}, 3]) == '[{"a":2,"b":1},3]'    # arrays keep order, objects sorted
    assert auth.canonical_json({"u": "é€"}) == '{"u":"é€"}'                     # no \u escaping, like JSON.stringify
    with pytest.raises(ValueError):
        auth.canonical_json({"x": float("nan")})


def test_body_hash_and_message_follow_the_documented_formats():
    assert auth.body_hash(None) == ""
    h = auth.body_hash({"a": 1})
    assert h == hashlib.sha256(b'{"a":1}').hexdigest()
    # docs examples: POST has an empty QUERY part; GET has an empty bodyHash part
    assert auth.signing_message("post", "/api/v1/merchant/orders", "", "abc123def456", 1709123456, "a3f1b2c4d5e6") == \
        "POST\n/api/v1/merchant/orders\n\nabc123def456\n1709123456\na3f1b2c4d5e6"
    assert auth.signing_message("GET", "/api/v1/merchant/payments", "cart_mandate_id=ORDER-123", "", 1709123456, "a3f1b2c4d5e6") == \
        "GET\n/api/v1/merchant/payments\ncart_mandate_id=ORDER-123\n\n1709123456\na3f1b2c4d5e6"


def test_sign_request_is_hmac_sha256_of_message_and_sends_hashed_bytes():
    body = {"cart_mandate": {"contents": {"id": "X"}}, "redirect_url": "https://a.b"}
    r = auth.sign_request(app_key="ak", app_secret="sec", method="POST", path="/api/v1/merchant/orders", body=body,
                          timestamp=1709123456, nonce="a3f1b2c4d5e6")
    msg = "POST\n/api/v1/merchant/orders\n\n" + hashlib.sha256(canon(body).encode()).hexdigest() + "\n1709123456\na3f1b2c4d5e6"
    assert r.headers["X-Signature"] == hmac_mod.new(b"sec", msg.encode(), hashlib.sha256).hexdigest()
    assert r.headers["X-App-Key"] == "ak" and r.headers["X-Timestamp"] == "1709123456" and r.headers["X-Nonce"] == "a3f1b2c4d5e6"
    assert r.body_bytes == canon(body).encode()      # signer and verifier hash the very same bytes
    g = auth.sign_request(app_key="ak", app_secret="sec", method="GET", path="/api/v1/merchant/payments",
                          query="flow_id=F1", timestamp=1, nonce="a" * 12)
    assert g.body_bytes is None and "Content-Type" not in g.headers


def test_each_request_gets_a_fresh_valid_nonce_and_bad_nonces_are_refused():
    a = auth.sign_request(app_key="ak", app_secret="s", method="GET", path="/p")
    b = auth.sign_request(app_key="ak", app_secret="s", method="GET", path="/p")
    assert a.headers["X-Nonce"] != b.headers["X-Nonce"]
    assert abs(int(a.headers["X-Timestamp"]) - time.time()) < 5
    for bad in ("short", "g" * 16, "a" * 33):
        with pytest.raises(ValueError):
            auth.sign_request(app_key="ak", app_secret="s", method="GET", path="/p", nonce=bad)
    auth.sign_request(app_key="ak", app_secret="s", method="GET", path="/p", nonce=str(uuid.uuid4()))
    with pytest.raises(HSPNotConfiguredError):
        auth.sign_request(app_key="", app_secret="s", method="GET", path="/p")


# ============================================================================ ES256K JWT
def test_merchant_authorization_jwt_matches_documented_profile():
    contents = build_cart_contents(SNAP, uuid.uuid4(), S, cart_expiry=expiry())
    token, claims = auth.build_merchant_authorization(contents, S)
    assert jwt.get_unverified_header(token) == {"alg": "ES256K", "typ": "JWT"}
    decoded = jwt.decode(token, MERCHANT_KEY.public_key(), algorithms=["ES256K"], audience="HashkeyMerchant")
    assert decoded["iss"] == decoded["sub"] == S.HSP_MERCHANT_NAME
    assert decoded["exp"] - decoded["iat"] == S.HSP_JWT_TTL_SECONDS
    assert decoded["jti"].startswith("JWT-") and decoded["jti"] == claims["jti"]
    assert decoded["cart_hash"] == hashlib.sha256(canon(contents).encode()).hexdigest() == auth.cart_hash(contents)
    assert len(decoded["cart_hash"]) == 64
    # any change to the cart changes cart_hash (the gateway would reject the order)
    contents["payment_request"]["details"]["total"]["amount"]["value"] = "99"
    assert auth.cart_hash(contents) != decoded["cart_hash"]
    # other algorithms must not verify
    with pytest.raises(jwt.PyJWTError):
        jwt.decode(token, MERCHANT_KEY.public_key(), algorithms=["ES256"], audience="HashkeyMerchant")


def test_jwt_requires_a_valid_secp256k1_key_and_never_echoes_it():
    bad = S.model_copy(update={"HSP_MERCHANT_PRIVATE_KEY_PEM": "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----"})
    with pytest.raises(HSPNotConfiguredError) as e:
        auth.build_merchant_authorization({"id": "x"}, bad)
    assert "not-a-key" not in e.value.message
    with pytest.raises(HSPNotConfiguredError):
        auth.build_merchant_authorization({"id": "x"}, S.model_copy(update={"HSP_MERCHANT_PRIVATE_KEY_PEM": ""}))


# ============================================================================ token registry (official table)
def test_token_registry_matches_official_table_for_hashkey_chain():
    usdt133, usdc133 = find_token(133, "usdt"), find_token(133, "USDC")
    usdt177, usdc177 = find_token(177, "USDT"), find_token(177, "USDC")
    assert usdt133.address == OFFICIAL_USDT_133 and usdt133.network == "hashkey-testnet" and usdt133.protocol == "permit2"
    assert usdc133.address == "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6" and usdc133.protocol == "eip3009"
    assert usdt177.address.lower() == "0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029" and usdt177.network == "hashkey"
    assert usdc177.address == "0x054ed45810DbBAb8B27668922D110669c9D88D0a"
    assert all(t.decimals == 6 for t in all_tokens()) and len(all_tokens()) == 4
    assert find_token(1, "USDT") is None and find_token(133, "DOGE") is None
    assert usdt133.to_units(Decimal("0.25")) == 250_000 and usdt133.caip2 == "eip155:133"


# ============================================================================ Cart Mandate
def test_cart_mandate_structure_matches_official_schema():
    iid = uuid.uuid4()
    c = build_cart_contents(SNAP, iid, S, cart_expiry=datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC))
    assert c["id"] == cart_mandate_id_for(iid) == f"PM-{iid}"
    assert c["user_cart_confirmation_required"] is True and c["merchant_name"] == S.HSP_MERCHANT_NAME
    assert c["cart_expiry"] == "2030-01-02T03:04:05Z"
    m = c["payment_request"]["method_data"][0]
    assert m["supported_methods"] == "https://www.x402.org/"
    assert m["data"] == {"x402Version": 2, "network": "hashkey-testnet", "chain_id": 133, "contract_address": OFFICIAL_USDT_133,
                         "pay_to": RECIPIENT, "coin": "USDT"}
    d = c["payment_request"]["details"]
    assert d["id"] == payment_request_id_for(iid) == f"PMR-{iid}"
    assert d["total"] == {"label": "Total", "amount": {"currency": "USD", "value": "0.25"}}
    assert d["display_items"][0]["amount"] == {"currency": "USD", "value": "0.25"}
    assert "modifiers" not in d            # PayMesh adds no add-on charges
    validate_amount_rules(c)
    body, meta = build_order_request(SNAP, iid, S, cart_expiry=expiry())
    assert set(body) <= {"cart_mandate", "redirect_url"} and set(body["cart_mandate"]) == {"contents", "merchant_authorization"}
    assert meta["cart_hash"] == auth.cart_hash(body["cart_mandate"]["contents"])


def test_cart_is_built_only_from_the_snapshot_and_rejects_unsupported_tokens_and_bad_amounts():
    with pytest.raises(UnprocessableError) as e:
        build_cart_contents({**SNAP, "chain_id": 1}, uuid.uuid4(), S, cart_expiry=expiry())
    assert e.value.code == "hsp_token_unsupported"
    with pytest.raises(UnprocessableError):
        build_cart_contents({**SNAP, "asset": "DOGE"}, uuid.uuid4(), S, cart_expiry=expiry())
    with pytest.raises(UnprocessableError):
        build_cart_contents({**SNAP, "amount": "0"}, uuid.uuid4(), S, cart_expiry=expiry())
    # untrusted provider name is sanitized for display; it can never alter amounts or recipient
    c = build_cart_contents({**SNAP, "provider_name": '<script>"x"</script>\n' + "A" * 200}, uuid.uuid4(), S, cart_expiry=expiry())
    label = c["payment_request"]["details"]["display_items"][0]["label"]
    assert "<" not in label and '"' not in label and len(label) <= 80
    # USDC on mainnet resolves to the official mainnet address
    c = build_cart_contents({**SNAP, "asset": "USDC", "chain_id": 177}, uuid.uuid4(), S, cart_expiry=expiry())
    assert c["payment_request"]["method_data"][0]["data"]["network"] == "hashkey"
    assert c["payment_request"]["method_data"][0]["data"]["contract_address"] == "0x054ed45810DbBAb8B27668922D110669c9D88D0a"
    bad = build_cart_contents(SNAP, uuid.uuid4(), S, cart_expiry=expiry())
    bad["payment_request"]["details"]["display_items"][0]["amount"]["value"] = "0.30"
    with pytest.raises(UnprocessableError):
        validate_amount_rules(bad)


# ============================================================================ gateway client vs spec-checking fake
def fresh(hsp_fake: FakeHSP | None = None, **cfg):  # noqa: ANN003, ANN201
    fake = hsp_fake or FakeHSP(S.HSP_APP_KEY, S.HSP_APP_SECRET, MERCHANT_KEY.public_key())
    settings = S.model_copy(update={"HSP_MAX_RETRIES": 2, **cfg})
    return fake, HSPGateway(settings, transport=httpx.MockTransport(fake.handler))


async def test_create_order_is_accepted_by_a_spec_strict_gateway():
    fake, gw = fresh()
    iid = uuid.uuid4()
    body, meta = build_order_request(SNAP, iid, S, cart_expiry=expiry())
    res = await gw.create_order(body["cart_mandate"])
    assert res.payment_request_id == payment_request_id_for(iid) and res.payment_url.startswith("https://")
    assert res.multi_pay is False
    assert fake.calls == [("POST", "/api/v1/merchant/orders", "")]
    assert cart_mandate_id_for(iid) in fake.orders


async def test_gateway_rejects_wrong_secret_replayed_nonce_and_tampered_cart():
    fake, _ = fresh()
    _, bad = fresh(fake, HSP_APP_SECRET="wrong-secret")
    body, _ = build_order_request(SNAP, uuid.uuid4(), S, cart_expiry=expiry())
    with pytest.raises(HSPAuthError):
        await bad.create_order(body["cart_mandate"])
    # tampered contents after signing -> the fake (like the real gateway) detects the cart_hash mismatch
    _, gw = fresh(fake)
    body["cart_mandate"]["contents"]["payment_request"]["details"]["total"]["amount"]["value"] = "0.01"
    body["cart_mandate"]["contents"]["payment_request"]["details"]["display_items"][0]["amount"]["value"] = "0.01"
    with pytest.raises(HSPApiError) as e:
        await gw.create_order(body["cart_mandate"])
    assert e.value.hsp_code == 10001 or isinstance(e.value, HSPAuthError)
    # replayed nonce
    sr = auth.sign_request(app_key=S.HSP_APP_KEY, app_secret=S.HSP_APP_SECRET, method="GET", path="/api/v1/merchant/payments",
                           query="flow_id=F", nonce="abcdef123456")
    async with httpx.AsyncClient(transport=httpx.MockTransport(fake.handler), base_url="https://x") as c:
        r1 = await c.get("/api/v1/merchant/payments?flow_id=F", headers=sr.headers)
        r2 = await c.get("/api/v1/merchant/payments?flow_id=F", headers=sr.headers)
    assert r1.json()["code"] == 10003 and r2.json()["code"] == 10002        # second use of the nonce is rejected


async def test_duplicate_cart_mandate_id_maps_to_documented_error_40001():
    fake, gw = fresh()
    iid = uuid.uuid4()
    body, _ = build_order_request(SNAP, iid, S, cart_expiry=expiry())
    await gw.create_order(body["cart_mandate"])
    body2, _ = build_order_request(SNAP, iid, S, cart_expiry=expiry())
    with pytest.raises(HSPApiError) as e:
        await gw.create_order(body2["cart_mandate"])
    assert e.value.hsp_code == 40001


async def test_get_is_retried_with_a_fresh_nonce_but_order_creation_never_is():
    fake, gw = fresh()
    fake.script = ["503", "429"]
    assert await gw.get_payment(payment_request_id="PMR-x") is None            # 3rd attempt: 10003 -> None
    gets = [c for c in fake.calls if c[0] == "GET"]
    assert len(gets) == 3
    assert len(fake.nonces) == 1                                               # failed attempts were rejected before auth; the success used a fresh nonce

    fake2, gw2 = fresh()
    body, _ = build_order_request(SNAP, uuid.uuid4(), S, cart_expiry=expiry())
    fake2.create_script = ["503"]
    with pytest.raises(HSPUnavailableError):
        await gw2.create_order(body["cart_mandate"])
    assert [c for c in fake2.calls if c[0] == "POST"] == [("POST", "/api/v1/merchant/orders", "")]   # exactly one attempt

    fake3, gw3 = fresh()
    fake3.create_script = ["timeout"]
    with pytest.raises(HSPAmbiguousOutcomeError):
        await gw3.create_order(body["cart_mandate"])
    assert len([c for c in fake3.calls if c[0] == "POST"]) == 1


async def test_get_gives_up_after_configured_retries():
    fake, gw = fresh(HSP_MAX_RETRIES=1)
    fake.script = ["503", "503", "503"]
    with pytest.raises(HSPUnavailableError):
        await gw.get_payment(flow_id="F")
    assert len(fake.calls) == 2


async def test_protocol_violations_and_secret_hygiene():
    def bad_handler(req):  # noqa: ANN001, ANN202
        return httpx.Response(200, text="<html>oops</html>")

    gw = HSPGateway(S, transport=httpx.MockTransport(bad_handler))
    with pytest.raises(HSPProtocolError):
        await gw.get_payment(payment_request_id="P")

    def malformed(req):  # noqa: ANN001, ANN202
        return httpx.Response(200, json={"code": 0, "data": {"no_status": 1}})

    gw = HSPGateway(S, transport=httpx.MockTransport(malformed))
    with pytest.raises(HSPProtocolError):
        await gw.get_payment(payment_request_id="P")

    def order_missing(req):  # noqa: ANN001, ANN202
        return httpx.Response(200, json={"code": 0, "data": {"payment_url": "https://x"}})

    gw = HSPGateway(S, transport=httpx.MockTransport(order_missing))
    with pytest.raises(HSPProtocolError):
        await gw.create_order({"contents": {}, "merchant_authorization": "x"})

    _, bad = fresh(HSP_APP_SECRET="wrong-secret-VALUE")
    with pytest.raises(HSPAuthError) as e:
        await bad.get_payment(payment_request_id="P")
    assert "wrong-secret-VALUE" not in repr(e.value.__dict__) and S.HSP_APP_KEY not in e.value.message
    with pytest.raises(ValueError):
        await gw.get_payment()
    with pytest.raises(HSPNotConfiguredError):
        HSPGateway(S.model_copy(update={"HSP_APP_KEY": ""}))


# ============================================================================ webhooks
def test_webhook_signature_roundtrip_and_failure_modes():
    secret = "as_test_secret_0001"
    body = json.dumps({"event_type": "payment", "payment_request_id": "PMR-1", "status": "payment-finalized"}).encode()
    now = int(time.time())
    hdr = sign_webhook(secret, body, now)
    assert hdr.startswith(f"t={now},v1=")
    p = verify_webhook(hdr, body, secret)
    assert p.payment_request_id == "PMR-1" and p.status == "payment-finalized"
    # independent computation of the documented HMAC(t + "." + raw_body)
    assert hdr.split("v1=")[1] == hmac_mod.new(secret.encode(), f"{now}.".encode() + body, hashlib.sha256).hexdigest()

    with pytest.raises(HSPWebhookError):
        verify_webhook(hdr, body + b" ", secret)                                    # body tampered
    with pytest.raises(HSPWebhookError):
        verify_webhook(hdr, body, "other-secret")                                   # wrong key
    with pytest.raises(HSPWebhookError):
        verify_webhook(sign_webhook(secret, body, now - 301), body, secret)         # too old
    with pytest.raises(HSPWebhookError):
        verify_webhook(sign_webhook(secret, body, now + 301), body, secret)         # from the future
    for bad in (None, "", "garbage", "t=abc,v1=ff", f"t={now}", "v1=ff"):
        with pytest.raises(HSPWebhookError):
            verify_webhook(bad, body, secret)
    with pytest.raises(HSPWebhookError):
        verify_webhook(hdr, body, "")                                               # unconfigured secret fails closed
    junk = b'{"not":"a payment"}'
    with pytest.raises(HSPWebhookError):
        verify_webhook(sign_webhook(secret, junk, now), junk, secret)               # signed but malformed payload
    big = b"x" * 70_000
    with pytest.raises(HSPWebhookError):
        verify_webhook(sign_webhook(secret, big, now), big, secret)


# ============================================================================ hardening
def test_hsp_environment_must_match_chain():
    qa = S.model_copy(update={"HSP_BASE_URL": "https://merchant-qa.hashkeymerchant.com", "HSK_CHAIN_ID": 133})
    assert qa.hsp_environment_error() is None
    assert "testnet-only" in S.model_copy(update={"HSP_BASE_URL": "https://merchant-qa.hashkeymerchant.com", "HSK_CHAIN_ID": 177}).hsp_environment_error()
    for host in ("https://hsp.hashkey.com", "https://merchant-stg.hashkeymerchant.com"):
        assert "mainnet-only" in S.model_copy(update={"HSP_BASE_URL": host, "HSK_CHAIN_ID": 133}).hsp_environment_error()
        assert S.model_copy(update={"HSP_BASE_URL": host, "HSK_CHAIN_ID": 177}).hsp_environment_error() is None
    assert S.model_copy(update={"HSP_BASE_URL": "https://my-proxy.internal", "HSK_CHAIN_ID": 133}).hsp_environment_error() is None


async def test_non_https_payment_url_is_rejected():
    def evil(req):  # noqa: ANN001, ANN202
        return httpx.Response(200, json={"code": 0, "data": {"payment_request_id": "P", "payment_url": "javascript:alert(1)", "multi_pay": False}})

    gw = HSPGateway(S, transport=httpx.MockTransport(evil))
    with pytest.raises(HSPProtocolError):
        await gw.create_order({"contents": {}, "merchant_authorization": "x"})


def test_qa_script_dry_run_prints_cart_and_sends_nothing(capsys, monkeypatch):
    import sys

    from app.scripts import hsp_qa_order

    monkeypatch.setattr(sys, "argv", ["x", "create", "--pay-to", RECIPIENT, "--amount", "0.01", "--dry-run"])
    assert hsp_qa_order.main() == 0
    out = capsys.readouterr().out
    assert "dry-run" in out and "cart_hash" in out and '"x402Version": 2' in out
    assert S.HSP_APP_SECRET not in out and "PRIVATE KEY" not in out
