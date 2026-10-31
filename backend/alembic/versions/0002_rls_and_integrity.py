"""Row Level Security, least-privilege grants and integrity triggers.

Security model
--------------
* The FastAPI backend connects with a privileged role (the Supabase `postgres` role, which bypasses RLS)
  and enforces authorization itself. RLS is the second wall: it protects the data when anything else
  talks to the database as `anon` / `authenticated` (supabase-js, PostgREST, the Realtime API).
* Clients get READ-ONLY access scoped to their own rows. All writes go through the API, where
  amounts, addresses, policies and state transitions are validated.
* `profiles.role` cannot be changed by clients (column-level UPDATE grant excludes it).
* payment_intents' condition snapshot is immutable; audit/receipt tables are append-only.

On plain PostgreSQL (CI / local) the Supabase `auth` schema and roles are stubbed if absent so the
same migration runs everywhere.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TABLES = [
    "profiles", "agents", "services", "procurement_requests", "quotations", "spending_policies",
    "payment_intents", "hsp_payment_flows", "payment_receipts", "agent_messages", "transaction_events", "reviews",
]

IMMUTABLE_COLS = [
    "request_id", "quotation_id", "buyer_id", "provider_agent_id", "amount", "asset",
    "chain_id", "recipient", "conditions_snapshot", "snapshot_hash", "idempotency_key",
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # --- Supabase compatibility shims (no-ops on a real Supabase database) ------------------------
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
        CREATE SCHEMA auth;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) THEN
        EXECUTE $f$
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
          $b$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $b$
        $f$;
      END IF;
    END $$;
    """)
    op.execute("GRANT USAGE ON SCHEMA public TO anon, authenticated")
    op.execute("GRANT USAGE ON SCHEMA auth TO anon, authenticated")
    op.execute("GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated")

    # profiles.id mirrors auth.users.id when that table exists (Supabase).
    op.execute("""
    DO $$
    BEGIN
      IF to_regclass('auth.users') IS NOT NULL THEN
        ALTER TABLE public.profiles
          ADD CONSTRAINT fk_profiles_auth_users FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
      END IF;
    END $$;
    """)

    # --- RLS on everything ----------------------------------------------------------------------------
    for t in TABLES + ["alembic_version"]:
        op.execute(f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY")

    # Least privilege: remove default Supabase grants, then grant read-only where intended.
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated")
    for t in TABLES:
        op.execute(f"GRANT SELECT ON public.{t} TO authenticated")
    op.execute("GRANT UPDATE (full_name, avatar_url, wallet_address) ON public.profiles TO authenticated")

    # --- policies ----------------------------------------------------------------------------------------
    op.execute("CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid())")
    op.execute("""CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
                  USING (id = auth.uid()) WITH CHECK (id = auth.uid())""")

    op.execute("""CREATE POLICY agents_select ON public.agents FOR SELECT TO authenticated
                  USING (status = 'active' OR owner_id = auth.uid())""")

    op.execute("""CREATE POLICY services_select ON public.services FOR SELECT TO authenticated
                  USING (EXISTS (SELECT 1 FROM public.agents a WHERE a.id = services.provider_agent_id
                                 AND (a.status = 'active' OR a.owner_id = auth.uid())))""")

    op.execute("""CREATE POLICY procurement_select_own ON public.procurement_requests FOR SELECT TO authenticated
                  USING (buyer_id = auth.uid())""")

    op.execute("""CREATE POLICY quotations_select ON public.quotations FOR SELECT TO authenticated
                  USING (
                    EXISTS (SELECT 1 FROM public.procurement_requests r WHERE r.id = quotations.request_id AND r.buyer_id = auth.uid())
                    OR EXISTS (SELECT 1 FROM public.agents a WHERE a.id = quotations.provider_agent_id AND a.owner_id = auth.uid())
                  )""")

    op.execute("""CREATE POLICY spending_policies_select_own ON public.spending_policies FOR SELECT TO authenticated
                  USING (user_id = auth.uid())""")

    op.execute("""CREATE POLICY payment_intents_select_own ON public.payment_intents FOR SELECT TO authenticated
                  USING (buyer_id = auth.uid())""")

    for t in ("hsp_payment_flows", "payment_receipts"):
        op.execute(f"""CREATE POLICY {t}_select_own ON public.{t} FOR SELECT TO authenticated
                      USING (EXISTS (SELECT 1 FROM public.payment_intents i
                                     WHERE i.id = {t}.payment_intent_id AND i.buyer_id = auth.uid()))""")

    op.execute("""CREATE POLICY transaction_events_select_own ON public.transaction_events FOR SELECT TO authenticated
                  USING (actor_id = auth.uid() OR EXISTS (SELECT 1 FROM public.payment_intents i
                         WHERE i.id = transaction_events.payment_intent_id AND i.buyer_id = auth.uid()))""")

    op.execute("""CREATE POLICY agent_messages_select ON public.agent_messages FOR SELECT TO authenticated
                  USING (
                    EXISTS (SELECT 1 FROM public.procurement_requests r WHERE r.id = agent_messages.request_id AND r.buyer_id = auth.uid())
                    OR EXISTS (SELECT 1 FROM public.agents a WHERE a.owner_id = auth.uid()
                               AND a.id IN (agent_messages.sender_agent_id, agent_messages.receiver_agent_id))
                  )""")

    op.execute("""CREATE POLICY reviews_select_all ON public.reviews FOR SELECT TO authenticated USING (true)""")

    # --- integrity triggers ------------------------------------------------------------------------------
    cond = " OR ".join(f"NEW.{c} IS DISTINCT FROM OLD.{c}" for c in IMMUTABLE_COLS)
    op.execute(f"""
    CREATE FUNCTION public.paymesh_guard_payment_intent() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF {cond} THEN
        RAISE EXCEPTION 'payment_intents condition snapshot is immutable';
      END IF;
      RETURN NEW;
    END $$;
    """)
    op.execute("""CREATE TRIGGER trg_payment_intents_immutable BEFORE UPDATE ON public.payment_intents
                  FOR EACH ROW EXECUTE FUNCTION public.paymesh_guard_payment_intent()""")

    op.execute("""
    CREATE FUNCTION public.paymesh_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
    END $$;
    """)
    for t in ("transaction_events", "payment_receipts"):
        op.execute(f"""CREATE TRIGGER trg_{t}_append_only BEFORE UPDATE OR DELETE ON public.{t}
                      FOR EACH ROW EXECUTE FUNCTION public.paymesh_append_only()""")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for t in ("transaction_events", "payment_receipts"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{t}_append_only ON public.{t}")
    op.execute("DROP TRIGGER IF EXISTS trg_payment_intents_immutable ON public.payment_intents")
    op.execute("DROP FUNCTION IF EXISTS public.paymesh_append_only()")
    op.execute("DROP FUNCTION IF EXISTS public.paymesh_guard_payment_intent()")
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS fk_profiles_auth_users")
    for t in TABLES + ["alembic_version"]:
        op.execute(f"ALTER TABLE public.{t} DISABLE ROW LEVEL SECURITY")
    # Policies are dropped with their tables' RLS disabled + explicit drops below.
    pols = {
        "profiles": ["profiles_select_own", "profiles_update_own"], "agents": ["agents_select"],
        "services": ["services_select"], "procurement_requests": ["procurement_select_own"],
        "quotations": ["quotations_select"], "spending_policies": ["spending_policies_select_own"],
        "payment_intents": ["payment_intents_select_own"],
        "hsp_payment_flows": ["hsp_payment_flows_select_own"], "payment_receipts": ["payment_receipts_select_own"],
        "transaction_events": ["transaction_events_select_own"], "agent_messages": ["agent_messages_select"],
        "reviews": ["reviews_select_all"],
    }
    for table, names in pols.items():
        for n in names:
            op.execute(f"DROP POLICY IF EXISTS {n} ON public.{table}")
