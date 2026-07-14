BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  public_id varchar(40) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('active','suspended')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix varchar(32) NOT NULL UNIQUE,
  secret_hash char(64) NOT NULL,
  scopes text[] NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON api_keys(tenant_id);

CREATE TABLE rewards (
  id uuid PRIMARY KEY,
  public_id varchar(40) NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  external_reference varchar(128),
  idempotency_key varchar(128) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  amount_value bigint NOT NULL CHECK (amount_value >= 0),
  amount_fraction integer NOT NULL CHECK (amount_fraction >= 0 AND amount_fraction < 100000000),
  currency varchar(12) NOT NULL,
  description varchar(256) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(32) NOT NULL CHECK (status IN ('created','claimable','claim_in_progress','claimed','expired','cancelled','failed','reconciliation_required')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  failure_code varchar(64),
  failure_message varchar(256),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, idempotency_key),
  UNIQUE(tenant_id, external_reference)
);
CREATE INDEX rewards_tenant_created_idx ON rewards(tenant_id, created_at DESC);
CREATE INDEX rewards_status_expiry_idx ON rewards(status, expires_at);

CREATE TABLE claim_tokens (
  id uuid PRIMARY KEY,
  reward_id uuid NOT NULL UNIQUE REFERENCES rewards(id) ON DELETE CASCADE,
  token_material char(43) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_operations (
  id uuid PRIMARY KEY,
  reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
  provider varchar(32) NOT NULL,
  operation_type varchar(32) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('pending','processing','ready','succeeded','retry','ambiguous','failed','cancelled')),
  external_operation_id varchar(256),
  provider_secret_ciphertext text,
  amount_value bigint NOT NULL,
  amount_fraction integer NOT NULL,
  currency varchar(12) NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error_code varchar(64),
  processing_started_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reward_id, operation_type)
);
CREATE INDEX provider_operations_work_idx ON provider_operations(state, next_retry_at, created_at);

CREATE TABLE reward_events (
  id uuid PRIMARY KEY,
  event_id varchar(40) NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reward_events_reward_idx ON reward_events(reward_id, created_at, id);

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY,
  public_id varchar(40) NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url varchar(2048) NOT NULL,
  secret_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  description varchar(120) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_tenant_idx ON webhook_endpoints(tenant_id);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES reward_events(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  attempt_count integer NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL CHECK (status IN ('pending','processing','delivered','retry','failed')),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_http_status integer,
  last_error_code varchar(64),
  response_bytes integer,
  processing_started_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, endpoint_id)
);
CREATE INDEX webhook_deliveries_work_idx ON webhook_deliveries(status, next_attempt_at);

INSERT INTO schema_migrations(version) VALUES ('001_initial');
COMMIT;
