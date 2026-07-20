# Architecture

The API validates callers and public claims; PostgreSQL is the coordination and state boundary; the worker alone performs provider, liquidity, retention, and webhook effects. wallet-core is a separate high-trust process reached through a persistent local RPC connection. Recipient wallets, webhook receivers, and exchanges are external.

## System context

```mermaid
flowchart LR
  I["Integrator"] -->|"tenant API key"| A["LibreReward API"]
  O["Operator"] -->|"separate RBAC key"| A
  R["Recipient browser"] -->|"bearer claim link"| A
  A --> P[("PostgreSQL")]
  W["Worker"] --> P
  W -->|"serialized RPC"| T["GNU Taler wallet-core"]
  T --> E["Exchange"]
  R --> RW["Recipient wallet"]
  RW --> E
  W -->|"signed final event"| I
```

## Reward lifecycle

```mermaid
stateDiagram-v2
  [*] --> created
  created --> claimable
  claimable --> claim_in_progress
  claimable --> expired
  claimable --> cancelled
  claim_in_progress --> claimed
  claim_in_progress --> claimable: known recoverable failure
  claim_in_progress --> failed
  claim_in_progress --> reconciliation_required: ambiguous outcome
  reconciliation_required --> claim_in_progress
  reconciliation_required --> claimed
  reconciliation_required --> failed
  reconciliation_required --> cancelled
```

## Claim sequence

```mermaid
sequenceDiagram
  participant I as Integrator
  participant A as API
  participant D as PostgreSQL
  participant R as Recipient
  participant W as Worker
  participant T as wallet-core
  I->>A: Create reward plus idempotency key
  A->>D: Reward, token hash, event
  A-->>I: Reward ID and bearer claim URL
  R->>A: Start claim
  A->>D: Lock and create one provider operation
  W->>D: Claim pending work
  W->>T: initiatePeerPushDebit
  T-->>W: Transaction ID
  W->>T: getTransactionById until shareable
  W->>D: Encrypt Taler URI and persist known ID
  R->>A: Poll status
  A-->>R: Bearer Taler URI / QR
  R->>T: Import in recipient wallet
  W->>T: Reconcile transaction
  W->>D: Final state and webhook delivery
  W-->>I: Signed final webhook
```

## Trust boundaries

```mermaid
flowchart TB
  subgraph Public["Public recipient boundary"]
    B["Browser"]
    RW["Recipient wallet"]
  end
  subgraph Tenant["Tenant boundary"]
    I["Integrator"]
    H["Webhook endpoint"]
  end
  subgraph Operations["Restricted operator boundary"]
    O["Operator"]
    A["API"]
    D[("PostgreSQL")]
    W["Worker"]
  end
  subgraph WalletHost["Wallet host boundary"]
    T["wallet-core RPC"]
    WD[("Wallet database")]
  end
  X["GNU Taler exchange"]
  B --> A
  RW --> X
  I --> A
  O --> A
  A --> D
  W --> D
  W --> T
  T --> WD
  T --> X
  W --> H
```

## Unknown outcome

```mermaid
flowchart TD
  S["Initiate wallet operation"] --> Q{"Transaction ID received?"}
  Q -->|"yes"| K["Persist ID and reconcile by ID"]
  Q -->|"no; timeout/error after possible effect"| U["Mark reconciliation_required"]
  U --> N["Never initiate automatically again"]
  N --> M["Stop worker; inspect wallet using amount, summary, time, expiry"]
  M --> D{"Operator can prove no operation exists?"}
  D -->|"no"| U
  D -->|"yes, documented approval"| C["Separate compensating decision"]
```

Creation uses a tenant-scoped idempotency key and canonical request fingerprint. Claim start locks the reward and token, consumes the capability, and creates one uniquely constrained provider operation. Workers use `FOR UPDATE SKIP LOCKED`; all wallet-affecting calls share a PostgreSQL advisory lock. This is effectively-once coordination, not a proof of mathematical exactly-once behavior across wallet-core.

Money is stored as whole `bigint` plus an eight-digit fraction. API and claim credentials are hashed. Provider URIs and webhook secrets use versioned AES-256-GCM envelopes. See [Threat model](THREAT_MODEL.md), [Data lifecycle](DATA_LIFECYCLE.md), and [Taler compatibility](TALER_COMPATIBILITY.md).
