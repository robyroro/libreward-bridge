BEGIN;

CREATE TABLE operator_accounts (
  id uuid PRIMARY KEY,
  public_id varchar(40) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('viewer','operator','admin')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_api_keys (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
  key_prefix varchar(32) NOT NULL UNIQUE,
  secret_hash char(64) NOT NULL,
  scopes text[] NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_api_keys_operator_idx ON operator_api_keys(operator_id);

CREATE TABLE operator_audit_events (
  id uuid PRIMARY KEY,
  event_id varchar(40) NOT NULL UNIQUE,
  operator_id uuid REFERENCES operator_accounts(id) ON DELETE SET NULL,
  operator_public_id varchar(40) NOT NULL,
  action varchar(64) NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id varchar(128),
  request_id varchar(128),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_audit_events_created_idx ON operator_audit_events(created_at DESC, id DESC);
CREATE INDEX operator_audit_events_operator_idx ON operator_audit_events(operator_public_id, created_at DESC);

CREATE FUNCTION prevent_operator_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'operator_audit_events is append-only';
END;
$$;
CREATE TRIGGER operator_audit_events_append_only
BEFORE UPDATE OR DELETE ON operator_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_operator_audit_mutation();

CREATE TABLE liquidity_snapshots (
  id uuid PRIMARY KEY,
  currency varchar(12) NOT NULL,
  available_value bigint NOT NULL,
  available_fraction integer NOT NULL CHECK (available_fraction >= 0 AND available_fraction < 100000000),
  pending_incoming varchar(64) NOT NULL,
  pending_outgoing varchar(64) NOT NULL,
  peer_payments_allowed boolean NOT NULL,
  have_production_balance boolean NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('ok','low','blocked')),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liquidity_snapshots_currency_checked_idx ON liquidity_snapshots(currency, checked_at DESC);

CREATE TABLE liquidity_check_requests (
  id uuid PRIMARY KEY,
  operator_id uuid REFERENCES operator_accounts(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX liquidity_check_requests_work_idx ON liquidity_check_requests(status, created_at);

CREATE TABLE retention_runs (
  id uuid PRIMARY KEY,
  trigger varchar(16) NOT NULL CHECK (trigger IN ('worker','operator')),
  dry_run boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('002_operator_hardening');
COMMIT;
