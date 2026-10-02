BEGIN;

ALTER TABLE provider_operations
  ADD COLUMN amount_effective_value bigint,
  ADD COLUMN amount_effective_fraction integer
    CHECK (amount_effective_fraction IS NULL OR (amount_effective_fraction >= 0 AND amount_effective_fraction < 100000000)),
  ADD COLUMN wallet_tx_major varchar(32),
  ADD COLUMN wallet_tx_minor varchar(64),
  ADD COLUMN initiated_at timestamptz;

CREATE INDEX provider_operations_external_idx ON provider_operations(external_operation_id)
  WHERE external_operation_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('003_wallet_rpc');
COMMIT;
