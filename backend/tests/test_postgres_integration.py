"""Real-PostgreSQL checks: Alembic migrations, RLS policies, grants and integrity triggers.

Run with:  TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5433/postgres pytest -m postgres
(the URL must point at a server where the user may CREATE DATABASE; a scratch DB is created and dropped).
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

URL = os.getenv("TEST_POSTGRES_URL")
pytestmark = [pytest.mark.postgres, pytest.mark.skipif(not URL, reason="set TEST_POSTGRES_URL")]
BACKEND = Path(__file__).resolve().parents[1]
DBNAME = f"paymesh_it_{uuid.uuid4().hex[:8]}"

ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


def _swap_db(url: str, name: str) -> str:
    return url.rsplit("/", 1)[0] + "/" + name


@pytest.fixture(scope="module")
def conn():  # noqa: ANN201
    admin = psycopg.connect(URL, autocommit=True)
    admin.execute(f'CREATE DATABASE "{DBNAME}"')
    test_url = _swap_db(URL, DBNAME)
    env = {**os.environ, "DATABASE_URL": test_url, "APP_ENV": "test"}
    for step in (["upgrade", "head"], ["check"]):
        res = subprocess.run([sys.executable, "-m", "alembic", *step], cwd=BACKEND, env=env, capture_output=True, text=True)
        assert res.returncode == 0, res.stdout + res.stderr
    c = psycopg.connect(test_url, autocommit=True)
    yield c
    c.close()
    admin.execute(f'DROP DATABASE IF EXISTS "{DBNAME}" WITH (FORCE)')
    admin.close()


def q(conn, sql, params=None):  # noqa: ANN001, ANN201
    cur = conn.execute(sql, params)
    return cur.fetchall() if cur.description else None


def as_user(conn, uid, sql, params=None):  # noqa: ANN001, ANN201
    """Run `sql` as the Supabase `authenticated` role with auth.uid() = uid, then restore."""
    with conn.transaction():
        conn.execute("SET LOCAL ROLE authenticated")
        conn.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))
        return q(conn, sql, params)


@pytest.fixture(scope="module")
def data(conn):  # noqa: ANN001, ANN201
    ids = {k: str(uuid.uuid4()) for k in ("agent", "svc", "req", "quote", "intent")}
    q(conn, "INSERT INTO profiles (id, email, role) VALUES (%s,'a@x.com','user'), (%s,'b@x.com','user')", (ALICE, BOB))
    q(conn, "INSERT INTO agents (id, owner_id, kind, name, description, wallet_address, category, capabilities, status) "
            "VALUES (%s,%s,'external','A','',%s,'crypto_research','[]','active')", (ids["agent"], BOB, "0x" + "44" * 20))
    q(conn, "INSERT INTO services (id, provider_agent_id, name, description, price, payment_asset, is_available, delivery_estimate_minutes) "
            "VALUES (%s,%s,'S','',0.5,'USDT',true,10)", (ids["svc"], ids["agent"]))
    q(conn, "INSERT INTO procurement_requests (id, buyer_id, description, category, requirements, max_budget, budget_asset, status, delivery_status) "
            "VALUES (%s,%s,'d','crypto_research','{}',1,'USDT','selected','not_started')", (ids["req"], ALICE))
    q(conn, "INSERT INTO quotations (id, request_id, provider_agent_id, price, payment_asset, chain_id, pay_to_address, "
            "delivery_estimate_minutes, response_details, status, expires_at) VALUES (%s,%s,%s,0.5,'USDT',133,%s,10,'{}','accepted', now()+interval '1 hour')",
      (ids["quote"], ids["req"], ids["agent"], "0x" + "44" * 20))
    q(conn, "INSERT INTO payment_intents (id, request_id, quotation_id, buyer_id, provider_agent_id, amount, asset, chain_id, recipient, "
            "status, conditions_snapshot, snapshot_hash, idempotency_key, expires_at) VALUES (%s,%s,%s,%s,%s,0.5,'USDT',133,%s,'VALIDATED','{}',%s,'k1', now()+interval '1 hour')",
      (ids["intent"], ids["req"], ids["quote"], ALICE, ids["agent"], "0x" + "44" * 20, "0" * 64))
    q(conn, "INSERT INTO transaction_events (id, payment_intent_id, actor_id, event_type, event_data) VALUES (gen_random_uuid(),%s,%s,'payment_validated','{}')",
      (ids["intent"], ALICE))
    return ids


def test_all_tables_have_rls_enabled(conn):
    rows = q(conn, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity")
    assert rows == []


def test_buyer_sees_only_own_rows(conn, data):
    assert len(as_user(conn, ALICE, "SELECT id FROM procurement_requests")) == 1
    assert as_user(conn, BOB, "SELECT id FROM procurement_requests") == []
    assert len(as_user(conn, ALICE, "SELECT id FROM payment_intents")) == 1
    assert as_user(conn, BOB, "SELECT id FROM payment_intents") == []
    assert as_user(conn, BOB, "SELECT id FROM transaction_events") == []
    assert len(as_user(conn, ALICE, "SELECT id FROM transaction_events")) == 1


def test_provider_owner_sees_quotes_for_own_agent_only(conn, data):
    assert len(as_user(conn, BOB, "SELECT id FROM quotations")) == 1      # Bob owns the quoting agent
    assert len(as_user(conn, ALICE, "SELECT id FROM quotations")) == 1    # Alice is the buyer
    assert as_user(conn, str(uuid.uuid4()), "SELECT id FROM quotations") == []


def test_profiles_isolated_and_role_not_updatable(conn, data):
    assert [r[0] for r in as_user(conn, ALICE, "SELECT email FROM profiles")] == ["a@x.com"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(conn, ALICE, "UPDATE profiles SET role='admin' WHERE id=%s", (ALICE,))
    as_user(conn, ALICE, "UPDATE profiles SET full_name='Alice' WHERE id=%s", (ALICE,))  # allowed column
    assert q(conn, "SELECT role, full_name FROM profiles WHERE id=%s", (ALICE,)) == [("user", "Alice")]
    # cannot touch someone else's profile (RLS filters the row; 0 rows updated)
    as_user(conn, ALICE, "UPDATE profiles SET full_name='pwned' WHERE id=%s", (BOB,))
    assert q(conn, "SELECT full_name FROM profiles WHERE id=%s", (BOB,)) == [(None,)]


def test_clients_have_no_write_access_to_financial_tables(conn, data):
    for sql in (
        "UPDATE payment_intents SET status='SETTLED'",
        "DELETE FROM payment_intents",
        "INSERT INTO payment_receipts (id, payment_intent_id, receipt_reference, settlement_status) VALUES (gen_random_uuid(), gen_random_uuid(),'r','SETTLED')",
        "UPDATE spending_policies SET daily_spending_limit=1000000",
        "UPDATE agents SET wallet_address='0x" + "ee" * 20 + "'",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_user(conn, ALICE, sql)


def test_anon_has_no_access(conn, data):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            conn.execute("SET LOCAL ROLE anon")
            conn.execute("SELECT * FROM agents")


def test_inactive_agents_hidden_from_other_users(conn, data):
    q(conn, "UPDATE agents SET status='inactive' WHERE id=%s", (data["agent"],))
    try:
        assert as_user(conn, ALICE, "SELECT id FROM agents") == []
        assert len(as_user(conn, BOB, "SELECT id FROM agents")) == 1  # owner still sees it
        assert as_user(conn, ALICE, "SELECT id FROM services") == []
    finally:
        q(conn, "UPDATE agents SET status='active' WHERE id=%s", (data["agent"],))


def test_payment_condition_snapshot_immutable_in_db(conn, data):
    for col, val in (("amount", "0.01"), ("recipient", "'0x" + "ee" * 20 + "'"), ("snapshot_hash", "'" + "1" * 64 + "'"),
                     ("chain_id", "1")):
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            q(conn, f"UPDATE payment_intents SET {col}={val}")
    q(conn, "UPDATE payment_intents SET status='AWAITING_SIGNATURE' WHERE id=%s", (data["intent"],))  # status is mutable


def test_audit_and_receipt_tables_are_append_only(conn, data):
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        q(conn, "UPDATE transaction_events SET event_type='x'")
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        q(conn, "DELETE FROM transaction_events")


def test_database_blocks_duplicate_active_payment_and_bad_values(conn, data):
    with pytest.raises(psycopg.errors.UniqueViolation):
        q(conn, "INSERT INTO payment_intents (id, request_id, quotation_id, buyer_id, provider_agent_id, amount, asset, chain_id, recipient, "
                "status, conditions_snapshot, snapshot_hash, idempotency_key, expires_at) SELECT gen_random_uuid(), request_id, quotation_id, buyer_id, "
                "provider_agent_id, amount, asset, chain_id, recipient, 'DRAFT', conditions_snapshot, snapshot_hash, 'other-key', expires_at "
                "FROM payment_intents LIMIT 1")
    with pytest.raises(psycopg.errors.CheckViolation):
        q(conn, "UPDATE payment_intents SET status='PAID'")
    with pytest.raises((psycopg.errors.CheckViolation, psycopg.errors.RaiseException)):
        q(conn, "UPDATE payment_intents SET amount=0")  # immutability trigger fires before the CHECK
    with pytest.raises(psycopg.errors.CheckViolation):
        q(conn, "UPDATE services SET price=-1")


# ------------------------------------------------------------------ migration 0003 (HSP integration)
def test_webhook_events_table_is_server_only(conn, data):
    assert q(conn, "SELECT relrowsecurity FROM pg_class WHERE relname='hsp_webhook_events'") == [(True,)]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(conn, ALICE, "SELECT * FROM hsp_webhook_events")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(conn, ALICE, "INSERT INTO hsp_webhook_events (id, body_sha256, payment_request_id, status, payload) "
                              "VALUES (gen_random_uuid(),'x','p','s','{}')")


def test_hsp_flow_and_receipt_integrity_constraints(conn, data):
    intent = data["intent"]
    q(conn, "INSERT INTO hsp_payment_flows (id, payment_intent_id, mandate_reference, payment_request_id, order_state) "
            "VALUES (gen_random_uuid(), %s, 'PM-1', 'PMR-1', 'created')", (intent,))
    with pytest.raises(psycopg.errors.UniqueViolation):      # one HSP order per intent
        q(conn, "INSERT INTO hsp_payment_flows (id, payment_intent_id, mandate_reference, order_state) "
                "VALUES (gen_random_uuid(), %s, 'PM-2', 'created')", (intent,))
    # clients can read their own flow only
    assert len(as_user(conn, ALICE, "SELECT id FROM hsp_payment_flows")) == 1
    assert as_user(conn, BOB, "SELECT id FROM hsp_payment_flows") == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(conn, ALICE, "UPDATE hsp_payment_flows SET gateway_status='payment-finalized'")

    q(conn, "INSERT INTO payment_receipts (id, payment_intent_id, receipt_reference, transaction_hash, settlement_status, "
            "verification_details, verified_amount) VALUES (gen_random_uuid(), %s, 'hsp:1', %s, 'payment-finalized', '{}', 0.5)",
      (intent, "0x" + "ab" * 32))
    with pytest.raises(psycopg.errors.UniqueViolation):      # one receipt per intent
        q(conn, "INSERT INTO payment_receipts (id, payment_intent_id, receipt_reference, settlement_status, verification_details) "
                "VALUES (gen_random_uuid(), %s, 'hsp:2', 'x', '{}')", (intent,))
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        q(conn, "UPDATE payment_receipts SET verified_amount=999")
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        q(conn, "DELETE FROM payment_receipts")
    assert len(as_user(conn, ALICE, "SELECT id FROM payment_receipts")) == 1
    assert as_user(conn, BOB, "SELECT id FROM payment_receipts") == []
