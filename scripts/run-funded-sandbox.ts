import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
import { decrypt } from "../src/domain/crypto.js";
import { publicId, uuid } from "../src/domain/ids.js";
import { verifyWebhookSignature } from "../src/domain/webhook-signing.js";
import { ProviderError } from "../src/providers/provider.js";
import { providerFor } from "../src/runtime.js";
import { OperationWorker } from "../src/services/operation-worker.js";
import { RewardService, type Tenant } from "../src/services/reward-service.js";
import { WebhookService } from "../src/services/webhook-service.js";

const confirmation = "valueless-demo-only";
const config = loadConfig();
const amount = process.env.SANDBOX_EVIDENCE_AMOUNT ?? "KUDOS:1";
const recipientWalletDb = process.env.TALER_RECIPIENT_WALLET_DB ?? "";
const raceRecipientWalletDb = process.env.TALER_RACE_RECIPIENT_WALLET_DB ?? "";
const currency = amount.split(":", 1)[0] ?? "";
const exchangeBaseUrl = config.TALER_EXCHANGE_BASE_URL;

if (process.env.SANDBOX_EVIDENCE_CONFIRM !== confirmation)
  throw new Error(`SANDBOX_EVIDENCE_CONFIRM=${confirmation} is required`);
if (config.LIBREREWARD_ENV !== "test" || config.PROVIDER !== "taler-wallet-cli")
  throw new Error("funded sandbox evidence requires test mode and the taler-wallet-cli provider");
if (!new Set(["KUDOS", "TESTKUDOS"]).has(currency))
  throw new Error("funded sandbox evidence permits only KUDOS or TESTKUDOS");
if (!config.supportedCurrencies.has(currency))
  throw new Error("sandbox evidence currency is not configured as supported");
if (!exchangeBaseUrl?.startsWith("https://"))
  throw new Error("an explicit HTTPS sandbox exchange is required");
const sandboxExchangeBaseUrl: string = exchangeBaseUrl;
if (!config.WEBHOOK_ALLOW_PRIVATE)
  throw new Error(
    "WEBHOOK_ALLOW_PRIVATE=true is required for the isolated local evidence receiver",
  );
if (!recipientWalletDb || recipientWalletDb === config.TALER_WALLET_DB)
  throw new Error("a separate TALER_RECIPIENT_WALLET_DB is required");
if (
  !raceRecipientWalletDb ||
  new Set([config.TALER_WALLET_DB, recipientWalletDb, raceRecipientWalletDb]).size !== 3
)
  throw new Error("a third, distinct TALER_RACE_RECIPIENT_WALLET_DB is required");

const receivedEvents: Array<{
  id: string;
  type: string;
  reward_id: string;
  signatureValid: boolean;
}> = [];
let webhookSecret = "";
const receiver = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(request.headers["x-libreward-timestamp"] ?? "");
    const signature = String(request.headers["x-libreward-signature"] ?? "");
    const eventId = String(request.headers["x-libreward-event-id"] ?? "");
    const signatureValid = verifyWebhookSignature(
      webhookSecret,
      timestamp,
      body,
      signature,
      Math.floor(Date.now() / 1000),
    );
    const payload = JSON.parse(body) as { id: string; type: string; reward_id: string };
    receivedEvents.push({
      id: eventId,
      type: payload.type,
      reward_id: payload.reward_id,
      signatureValid: signatureValid && payload.id === eventId,
    });
    response.statusCode = signatureValid ? 204 : 401;
    response.end();
  });
});

const pool = createPool(config.DATABASE_URL);
try {
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address();
  if (!address || typeof address === "string") throw new Error("evidence receiver did not bind");

  await migrate(pool);
  const tenant: Tenant = { id: uuid(), publicId: publicId("tn") };
  await pool.query(
    "INSERT INTO tenants(id,public_id,display_name,status) VALUES($1,$2,$3,'active')",
    [tenant.id, tenant.publicId, "Funded sandbox evidence"],
  );

  const provider = providerFor(config);
  const rewards = new RewardService(pool, config, provider);
  const webhooks = new WebhookService(pool, config);
  const operations = new OperationWorker(pool, config, provider);
  const endpoint = await webhooks.createEndpoint(tenant, {
    url: `http://127.0.0.1:${address.port}/libreward-evidence`,
    description: "Isolated funded sandbox evidence receiver",
  });
  webhookSecret = endpoint.secret;

  const externalReference = `sandbox-evidence:${Date.now()}`;
  const reward = await rewards.create(tenant, externalReference, {
    amount,
    description: "LibreReward funded sandbox evidence",
    external_reference: externalReference,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  if (!reward.claim_url) throw new Error("claim capability was already retained away");
  const claimToken = new URL(reward.claim_url).pathname.split("/").at(-1);
  if (!claimToken) throw new Error("claim token was not generated");
  await rewards.startClaim(claimToken);
  if (!(await operations.runOne())) throw new Error("provider operation was not processed");

  const claim = await rewards.claimStatus(claimToken, (ciphertext) =>
    decrypt(config.encryptionKey, ciphertext),
  );
  if (!claim.taler_uri?.startsWith("taler://pay-push/"))
    throw new Error("provider did not return a peer-push URI");

  const prepared = await proposeRecipient(recipientWalletDb, claim.taler_uri);
  await confirmRecipient(recipientWalletDb, prepared.transactionId);
  await Promise.all([
    runWallet(config.TALER_WALLET_DB, ["run-until-done"], 120_000),
    runWallet(recipientWalletDb, ["run-until-done"], 120_000),
  ]);

  // Recreate the worker boundary to prove a known transaction survives process restart.
  const restartedOperations = new OperationWorker(pool, config, providerFor(config));
  if (!(await restartedOperations.reconcileOne(reward.id)))
    throw new Error("completed provider operation was not reconcilable");
  if (!(await webhooks.deliverOne())) throw new Error("final webhook was not delivered");

  const persisted = (
    await pool.query<{ status: string }>("SELECT status FROM rewards WHERE public_id=$1", [
      reward.id,
    ])
  ).rows[0];
  const operation = (
    await pool.query<{ external_operation_id: string; state: string }>(
      `SELECT po.external_operation_id,po.state FROM provider_operations po
       JOIN rewards r ON r.id=po.reward_id WHERE r.public_id=$1`,
      [reward.id],
    )
  ).rows[0];
  const delivery = (
    await pool.query<{ status: string; event_id: string }>(
      `SELECT d.status,e.event_id FROM webhook_deliveries d
       JOIN reward_events e ON e.id=d.event_id JOIN rewards r ON r.id=e.reward_id
       WHERE r.public_id=$1 AND e.event_type='reward.claimed'`,
      [reward.id],
    )
  ).rows[0];
  const operationCount = Number(
    (
      await pool.query<{ count: bigint }>(
        `SELECT count(*) FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
         WHERE r.public_id=$1`,
        [reward.id],
      )
    ).rows[0]?.count ?? 0n,
  );
  const finalEvent = receivedEvents.find((event) => event.type === "reward.claimed");
  if (
    persisted?.status !== "claimed" ||
    operation?.state !== "succeeded" ||
    operationCount !== 1 ||
    delivery?.status !== "delivered" ||
    !finalEvent?.signatureValid ||
    finalEvent.reward_id !== reward.id
  )
    throw new Error("funded sandbox evidence assertions failed");

  const raceReference = `sandbox-race:${Date.now()}`;
  const raceReward = await rewards.create(tenant, raceReference, {
    amount,
    description: "LibreReward two-recipient race evidence",
    external_reference: raceReference,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  if (!raceReward.claim_url) throw new Error("race claim capability was already retained away");
  const raceToken = new URL(raceReward.claim_url).pathname.split("/").at(-1);
  if (!raceToken) throw new Error("race claim token was not generated");
  await rewards.startClaim(raceToken);
  if (!(await new OperationWorker(pool, config, providerFor(config)).runOne()))
    throw new Error("race provider operation was not processed");
  const raceClaim = await rewards.claimStatus(raceToken, (ciphertext) =>
    decrypt(config.encryptionKey, ciphertext),
  );
  if (!raceClaim.taler_uri?.startsWith("taler://pay-push/"))
    throw new Error("race provider did not return a peer-push URI");

  const [raceA, raceB] = await Promise.all([
    proposeRecipient(recipientWalletDb, raceClaim.taler_uri),
    proposeRecipient(raceRecipientWalletDb, raceClaim.taler_uri),
  ]);
  const confirmationResults = await Promise.allSettled([
    confirmRecipient(recipientWalletDb, raceA.transactionId),
    confirmRecipient(raceRecipientWalletDb, raceB.transactionId),
  ]);
  if (!confirmationResults.some((result) => result.status === "fulfilled"))
    throw new Error("both recipients failed before the race could start");
  await Promise.all([
    runWallet(config.TALER_WALLET_DB, ["run-until-done"], 120_000),
    runWallet(recipientWalletDb, ["run-until-done"], 120_000),
    runWallet(raceRecipientWalletDb, ["run-until-done"], 120_000),
  ]);
  if (!(await new OperationWorker(pool, config, providerFor(config)).reconcileOne(raceReward.id)))
    throw new Error("race provider operation was not reconcilable");
  if (!(await webhooks.deliverOne())) throw new Error("race final webhook was not delivered");

  let [raceATransaction, raceBTransaction] = await Promise.all([
    walletTransaction(recipientWalletDb, raceA.transactionId),
    walletTransaction(raceRecipientWalletDb, raceB.transactionId),
  ]);
  if (raceATransaction.txState.major === "dialog") {
    await runWallet(recipientWalletDb, ["transactions", "abort", raceA.transactionId]);
    await runWallet(recipientWalletDb, ["run-until-done"], 120_000);
    raceATransaction = await walletTransaction(recipientWalletDb, raceA.transactionId);
  }
  if (raceBTransaction.txState.major === "dialog") {
    await runWallet(raceRecipientWalletDb, ["transactions", "abort", raceB.transactionId]);
    await runWallet(raceRecipientWalletDb, ["run-until-done"], 120_000);
    raceBTransaction = await walletTransaction(raceRecipientWalletDb, raceB.transactionId);
  }
  const raceStates = [raceATransaction.txState.major, raceBTransaction.txState.major];
  const raceOperationCount = Number(
    (
      await pool.query<{ count: bigint }>(
        `SELECT count(*) FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
         WHERE r.public_id=$1`,
        [raceReward.id],
      )
    ).rows[0]?.count ?? 0n,
  );
  const raceOperation = (
    await pool.query<{ external_operation_id: string }>(
      `SELECT po.external_operation_id FROM provider_operations po
       JOIN rewards r ON r.id=po.reward_id WHERE r.public_id=$1`,
      [raceReward.id],
    )
  ).rows[0];
  const racePersisted = (
    await pool.query<{ status: string }>("SELECT status FROM rewards WHERE public_id=$1", [
      raceReward.id,
    ])
  ).rows[0];
  if (
    racePersisted?.status !== "claimed" ||
    raceOperationCount !== 1 ||
    raceStates.filter((state) => state === "done").length !== 1 ||
    raceStates.some((state) => !new Set(["done", "failed", "aborted"]).has(state))
  )
    throw new Error("two-recipient race assertions failed");

  let insufficientBalanceCode = "";
  try {
    await providerFor(config).createRewardOperation({
      operationId: uuid(),
      amount: { currency, value: 999_999n, fraction: 0 },
      summary: "LibreReward insufficient balance evidence",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    throw new Error("insufficient operator balance unexpectedly returned a claim URI");
  } catch (error) {
    if (!(error instanceof ProviderError) || error.classification !== "permanent") throw error;
    insufficientBalanceCode = error.code;
  }

  const expiryReference = `sandbox-expiry:${Date.now()}`;
  const expiresAt = new Date(Date.now() + 20_000);
  const expiryReward = await rewards.create(tenant, expiryReference, {
    amount,
    description: "LibreReward expired purse evidence",
    external_reference: expiryReference,
    expires_at: expiresAt.toISOString(),
  });
  if (!expiryReward.claim_url) throw new Error("expiry claim capability was already retained away");
  const expiryToken = new URL(expiryReward.claim_url).pathname.split("/").at(-1);
  if (!expiryToken) throw new Error("expiry claim token was not generated");
  await rewards.startClaim(expiryToken);
  if (!(await new OperationWorker(pool, config, providerFor(config)).runOne()))
    throw new Error("expiry provider operation was not processed");
  await delay(Math.max(0, expiresAt.getTime() - Date.now()) + 2_000);
  await runWallet(config.TALER_WALLET_DB, ["run-until-done"], 60_000);
  if (!(await new OperationWorker(pool, config, providerFor(config)).reconcileOne(expiryReward.id)))
    throw new Error("expired provider operation was not reconcilable");
  if (!(await webhooks.deliverOne())) throw new Error("expiry final webhook was not delivered");
  const expiryPersisted = (
    await pool.query<{
      reward_status: string;
      provider_state: string;
      operation_count: bigint;
      external_operation_id: string;
    }>(
      `SELECT r.status AS reward_status,po.state AS provider_state,po.external_operation_id,
        (SELECT count(*) FROM provider_operations counted WHERE counted.reward_id=r.id) AS operation_count
       FROM rewards r JOIN provider_operations po ON po.reward_id=r.id WHERE r.public_id=$1`,
      [expiryReward.id],
    )
  ).rows[0];
  if (
    expiryPersisted?.reward_status !== "failed" ||
    !new Set(["failed", "cancelled"]).has(expiryPersisted.provider_state) ||
    Number(expiryPersisted.operation_count) !== 1
  )
    throw new Error("expired purse assertions failed");

  const operatorBalance = JSON.parse(
    await runWallet(config.TALER_WALLET_DB, ["balance", "--json"]),
  ) as { haveProdBalance: boolean };
  const recipientBalance = JSON.parse(
    await runWallet(recipientWalletDb, ["balance", "--json"]),
  ) as {
    haveProdBalance: boolean;
  };
  process.stdout.write(
    `${JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        exchange: sandboxExchangeBaseUrl,
        amount,
        reward_id: reward.id,
        reward_status: persisted.status,
        provider_transaction_id: operation.external_operation_id,
        provider_state: operation.state,
        provider_operation_count: operationCount,
        recipient_transaction_id: prepared.transactionId,
        webhook_event_id: delivery.event_id,
        webhook_status: delivery.status,
        webhook_signature_valid: finalEvent.signatureValid,
        operator_has_production_balance: operatorBalance.haveProdBalance,
        recipient_has_production_balance: recipientBalance.haveProdBalance,
        restart_reconciliation_verified: true,
        race: {
          reward_id: raceReward.id,
          reward_status: racePersisted.status,
          provider_transaction_id: raceOperation?.external_operation_id,
          provider_operation_count: raceOperationCount,
          recipient_states: raceStates,
          exactly_one_recipient_completed:
            raceStates.filter((state) => state === "done").length === 1,
        },
        insufficient_balance: {
          false_claim_uri_returned: false,
          provider_error_code: insufficientBalanceCode,
        },
        expired_purse: {
          reward_id: expiryReward.id,
          reward_status: expiryPersisted.reward_status,
          provider_transaction_id: expiryPersisted.external_operation_id,
          provider_state: expiryPersisted.provider_state,
          provider_operation_count: Number(expiryPersisted.operation_count),
          replacement_purse_created: false,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  webhookSecret = "";
  receiver.close();
  await pool.end();
}

async function proposeRecipient(walletDb: string, talerUri: string) {
  await runWallet(walletDb, ["exchanges", "accept-tos", sandboxExchangeBaseUrl]);
  const prepared = JSON.parse(
    await runWallet(walletDb, ["p2p", "prepare-push-credit", talerUri]),
  ) as { transactionId: string };
  if (!prepared.transactionId?.startsWith("txn:peer-push-credit:"))
    throw new Error("recipient wallet did not prepare a peer-push credit");
  return prepared;
}

async function confirmRecipient(walletDb: string, transactionId: string) {
  await runWallet(walletDb, ["p2p", "confirm-push-credit", transactionId]);
}

async function walletTransaction(walletDb: string, transactionId: string) {
  return JSON.parse(await runWallet(walletDb, ["transactions", "lookup", transactionId])) as {
    txState: { major: string; minor?: string };
  };
}

function runWallet(walletDb: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const nodeScript = config.TALER_WALLET_CLI_NODE_SCRIPT;
    const command = nodeScript ? process.execPath : config.TALER_WALLET_CLI;
    const globalArgs = [
      "-L",
      "NONE",
      ...(config.TALER_WALLET_CRYPTO_WORKER
        ? [`--crypto-worker=${config.TALER_WALLET_CRYPTO_WORKER}`]
        : []),
      `--wallet-db=${walletDb}`,
    ];
    const commandArgs = nodeScript
      ? [nodeScript, ...globalArgs, ...args]
      : [...globalArgs, ...args];
    const child = spawn(command, commandArgs, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`wallet command timed out: ${args[0] ?? "unknown"}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.stderr.resume();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`wallet command could not start: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`wallet command failed: ${args[0] ?? "unknown"} (exit ${code})`));
    });
  });
}
