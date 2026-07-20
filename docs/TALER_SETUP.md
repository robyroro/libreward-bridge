# GNU Taler sandbox setup

LibreReward uses wallet-core peer push, not a merchant reward endpoint. The current official wallet-core API documents `initiatePeerPushDebit`, `getTransactionById`, and `abortTransaction`; current transaction records use `type: "peer-push-debit"` and expose a `taler://pay-push/` URI while ready.

## Verified upstream baseline

On 2026-07-12 the provider was checked against official `taler-typescript-core` revision `20c1818449d024bd36fd7fc146631ecc44858fa3`:

- wallet CLI implementation `1.6.10`;
- wallet protocol `7:0:0`;
- exchange protocol `34:0:9`;
- Bridge `provider:check` succeeded through the direct `getVersion` API.

The historical unscoped `taler-wallet` npm package is unpublished, and the scoped registry package was still `0.8.1`. Build the current official source instead of silently using that stale package.

Official references:

- <https://docs.taler.net/wallet/wallet-core.html>
- <https://docs.taler.net/developer/taler-wallet-developer.html>
- <https://git.taler.net/taler-typescript-core.git/>
- <https://docs.taler.net/checklists/checklist-demo-upgrade.html>

## Build the current wallet CLI

Use a Linux sandbox host or container with the prerequisites listed by upstream (Node.js, Python, pnpm, jq, zip, and standard build tools):

```sh
git clone https://git.taler.net/taler-typescript-core.git
cd taler-typescript-core
git rev-parse HEAD
./bootstrap
./configure --prefix="$HOME/.local"
make install
"$HOME/.local/bin/taler-wallet-cli" --version
```

For a source-tree Node entrypoint, set `TALER_WALLET_CLI_NODE_SCRIPT` to the official `packages/taler-wallet-cli/bin/taler-wallet-cli.mjs`. This option was added for controlled source-build verification; the upstream SQLite helper must still be installed and discoverable. `TALER_WALLET_CRYPTO_WORKER=sync` can be used by that controlled source-tree setup when worker threads are unavailable. The normal packaged deployment should leave both values empty and set `TALER_WALLET_CLI=taler-wallet-cli`.

## Fund valueless sandbox wallets

1. Create a dedicated operator wallet database and a separate recipient wallet.
2. Use a GNU Taler Sandcastle/demo bank and exchange that support peer payments.
3. Withdraw only valueless test currency into the operator wallet.
4. Record the exact wallet revision, protocol versions, exchange URL, currency, and test time.
5. Never reuse production credentials, balances, wallet files, or claim links.

Before starting LibreReward, prove the upstream flow manually. Do not run `run-until-done` before handing the URI to the recipient: peer-push completion waits for the recipient, so doing that would deadlock the handoff.

```sh
taler-wallet-cli --wallet-db=/secure/libreward-wallet.sqlite3 p2p initiate-push-debit \
  --purse-expiration="1 h" --summary="LibreReward sandbox proof" TESTKUDOS:1
taler-wallet-cli --wallet-db=/secure/libreward-wallet.sqlite3 transactions
```

The output must contain a pending/ready `peer-push-debit` transaction and a `taler://pay-push/` URI. Import that URI into the separate recipient wallet, confirm it there, and only then run each wallet until done. Do not count QR rendering or a mock-provider URI as a successful Taler transaction. LibreReward's preferred path polls stable `getTransactionById` over a persistent wallet RPC connection. The testing wait API is available only through an explicit valueless-sandbox compatibility flag and is forbidden in production mode.

## Configure LibreReward

```dotenv
LIBREREWARD_ENV=test
PROVIDER=taler-wallet-cli
TALER_WALLET_CLI=taler-wallet-cli
TALER_WALLET_CLI_NODE_SCRIPT=
TALER_WALLET_CRYPTO_WORKER=
TALER_WALLET_DB=/secure/libreward-wallet.sqlite3
TALER_WALLET_CONNECTION=/secure/run/libreward-wallet.sock
TALER_WALLET_ALLOW_TESTING_API=false
TALER_WALLET_COMMAND_TIMEOUT_MS=60000
TALER_EXCHANGE_BASE_URL=https://exchange.demo.taler.net/
TALER_ALLOW_HTTP=false
SUPPORTED_CURRENCIES=TESTKUDOS
```

Start the single wallet owner before the Bridge worker:

```sh
taler-wallet-cli --wallet-db=/secure/libreward-wallet.sqlite3 advanced serve \
  --unix-path=/secure/run/libreward-wallet.sock
```

The exact CLI flags remain an upstream compatibility question; verify them against the supported source revision and [compatibility matrix](TALER_COMPATIBILITY.md). Never start another process against the same wallet database. Stop the Bridge worker before direct wallet CLI maintenance.

Then run:

```sh
npm run build
node dist/src/cli.js provider:check
node dist/src/cli.js migrate
node dist/src/server.js
node dist/src/worker-main.js
```

Create a small test reward, start the claim, complete it in the recipient wallet, and confirm the Bridge reaches `claimed` and emits one verifiable final webhook.

## Reproducible evidence harness

The guarded harness runs the funded matrix and prints only sanitized public identifiers and states:

```sh
LIBREREWARD_ENV=test \
PROVIDER=taler-wallet-cli \
TALER_EXCHANGE_BASE_URL=https://exchange.demo.taler.net/ \
SUPPORTED_CURRENCIES=KUDOS \
TALER_WALLET_DB=/secure/operator.sqlite3 \
TALER_RECIPIENT_WALLET_DB=/secure/recipient-a.sqlite3 \
TALER_RACE_RECIPIENT_WALLET_DB=/secure/recipient-b.sqlite3 \
WEBHOOK_ALLOW_PRIVATE=true \
SANDBOX_EVIDENCE_CONFIRM=valueless-demo-only \
npm run sandbox:evidence
```

All three wallet databases must be distinct. The exchange must use HTTPS and the currency must be `KUDOS` or `TESTKUDOS`. `WEBHOOK_ALLOW_PRIVATE=true` is only for the isolated local evidence receiver. Never publish the wallet databases, claim URIs, or environment secrets. The verified sanitized result is recorded in `SANDBOX_EVIDENCE_2026-07-12.md`.

## Required sandbox evidence matrix

| Case | Expected Bridge result |
| --- | --- |
| Successful claim | One provider operation; reward becomes `claimed`; final webhook is signed. |
| Two recipients race on one URI | At most one recipient completes; no duplicate Bridge provider operation. |
| API/worker restart | Known external transaction ID reconciles without initiating another purse. |
| Timeout before transaction ID is known | `reconciliation_required`; no automatic retry. |
| Expired purse | Provider/reward reaches a documented terminal or reconciliation state without reissue. |
| Insufficient operator balance | Classified failure; no false claim URL. |
| KYC/terms/network interruption | No false success; operator evidence records upstream error and recovery path. |
| Cancellation before claim start | Local claim is revoked without provider initiation. |

Capture sanitized command versions, public transaction IDs, state changes, and webhook event IDs. Never capture API keys, claim tokens, webhook secrets, decrypted provider URIs, wallet private data, or recipient identity.

## Current boundary

Historical evidence verified source compilation, wallet `getVersion`, Bridge `provider:check`, PostgreSQL flows, and a funded valueless matrix. This does not certify production readiness. Current exact supported versions and remaining upstream questions are documented in [TALER_COMPATIBILITY.md](TALER_COMPATIBILITY.md). Do not enable real money until interoperability, independent review, and owner legal/treasury decisions are complete.
