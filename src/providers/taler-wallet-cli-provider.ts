import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Config } from "../config.js";
import { serializeAmount } from "../domain/money.js";
import {
  type CreateOperation,
  ProviderError,
  type ProviderResult,
  type RewardPaymentProvider,
} from "./provider.js";

type Transaction = {
  transactionId: string;
  type: string;
  txState: { major: string; minor?: string };
  talerUri?: string;
  amountRaw: string;
};

type WalletBalances = {
  balances: Array<{
    scopeInfo: { currency: string };
    available: string;
    pendingIncoming: string;
    pendingOutgoing: string;
    disablePeerPayments?: boolean;
  }>;
  haveProdBalance: boolean;
};

type CliOptions = Pick<
  Config,
  | "TALER_WALLET_CLI"
  | "TALER_WALLET_CLI_NODE_SCRIPT"
  | "TALER_WALLET_CRYPTO_WORKER"
  | "TALER_WALLET_COMMAND_TIMEOUT_MS"
  | "TALER_WALLET_DB"
  | "TALER_EXCHANGE_BASE_URL"
>;

export class TalerWalletCliProvider implements RewardPaymentProvider {
  readonly key = "taler-wallet-cli";
  constructor(private readonly options: CliOptions) {}

  async verifyConfiguration(): Promise<void> {
    await this.run(["--version"], 10_000);
    await this.api("getVersion", {});
  }

  async getBalances() {
    const result = await this.api<WalletBalances>("getBalances", {});
    return {
      balances: result.balances.map((balance) => ({
        currency: balance.scopeInfo.currency,
        available: balance.available,
        pendingIncoming: balance.pendingIncoming,
        pendingOutgoing: balance.pendingOutgoing,
        peerPaymentsAllowed: balance.disablePeerPayments !== true,
      })),
      haveProductionBalance: result.haveProdBalance,
    };
  }

  async createRewardOperation(input: CreateOperation): Promise<ProviderResult> {
    let initiated: { transactionId: string };
    try {
      initiated = await this.api("initiatePeerPushDebit", {
        ...(this.options.TALER_EXCHANGE_BASE_URL
          ? { exchangeBaseUrl: this.options.TALER_EXCHANGE_BASE_URL }
          : {}),
        partialContractTerms: {
          amount: serializeAmount(input.amount),
          summary: input.summary,
          purse_expiration: { t_s: Math.floor(input.expiresAt.getTime() / 1000) },
        },
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "ambiguous",
        "wallet_cli_initiate_unknown",
        "wallet-core initiation outcome is unknown",
      );
    }
    // Wait only until the purse can be shared (or reaches a terminal state). `run-until-done`
    // also waits for the recipient to claim, which deadlocks claim-URI publication.
    await this.api("testingWaitTransactionState", {
      transactionId: initiated.transactionId,
      txState: [
        { major: "pending", minor: "ready" },
        { major: "done" },
        { major: "failed", minor: "*" },
        { major: "aborted", minor: "*" },
      ],
    });
    return this.getOperationStatus(initiated.transactionId);
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    const tx = await this.api<Transaction>("getTransactionById", {
      transactionId: externalOperationId,
    });
    if (tx.type !== "peer-push-debit")
      throw new ProviderError(
        "permanent",
        "wallet_tx_type",
        "wallet transaction is not peer-push-debit",
      );
    if (tx.talerUri && !tx.talerUri.startsWith("taler://pay-push/"))
      throw new ProviderError(
        "permanent",
        "wallet_uri_scheme",
        "wallet returned a non peer-push URI",
      );
    const base = { externalOperationId, amount: tx.amountRaw };
    switch (tx.txState.major) {
      case "done":
        return { ...base, state: "succeeded" };
      case "failed":
      case "expired":
      case "deleted":
        return { ...base, state: "failed", errorCode: `wallet_${tx.txState.major}` };
      case "aborted":
        return { ...base, state: "cancelled" };
      default:
        return tx.talerUri
          ? { ...base, state: "ready", claimUri: tx.talerUri }
          : { ...base, state: "pending" };
    }
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    await this.api("abortTransaction", { transactionId: externalOperationId });
    return { state: "cancelled", externalOperationId };
  }

  private async api<T>(operation: string, request: Record<string, unknown>): Promise<T> {
    const stdout = await this.run(
      [`--wallet-db=${this.options.TALER_WALLET_DB}`, "api", operation, JSON.stringify(request)],
      this.options.TALER_WALLET_COMMAND_TIMEOUT_MS,
    );
    try {
      const parsed = JSON.parse(stdout) as
        | {
            type?: string;
            result?: T;
            error?: {
              code?: number;
              talerErrorCode?: number;
              hint?: string;
              message?: string;
            };
          }
        | T;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        parsed.type === "error"
      ) {
        const detail = parsed as {
          error?: { code?: number; talerErrorCode?: number; hint?: string; message?: string };
        };
        throw new ProviderError(
          "permanent",
          `taler_${detail.error?.code ?? detail.error?.talerErrorCode ?? "unknown"}`,
          detail.error?.hint ?? detail.error?.message ?? "wallet-core error",
        );
      }
      return (
        typeof parsed === "object" && parsed !== null && "result" in parsed ? parsed.result : parsed
      ) as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "permanent",
        "wallet_cli_invalid_json",
        "wallet-core returned invalid JSON",
      );
    }
  }

  private run(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const nodeScript = this.options.TALER_WALLET_CLI_NODE_SCRIPT;
      const command = nodeScript ? process.execPath : this.options.TALER_WALLET_CLI;
      const cryptoWorker = this.options.TALER_WALLET_CRYPTO_WORKER;
      const globalArgs = cryptoWorker ? [`--crypto-worker=${cryptoWorker}`] : [];
      const commandArgs = nodeScript
        ? [nodeScript, ...globalArgs, ...args]
        : [...globalArgs, ...args];
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, commandArgs, {
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdin.end();
      } catch (error) {
        reject(
          new ProviderError(
            "permanent",
            "wallet_cli_unavailable",
            error instanceof Error ? error.message : "wallet CLI could not be started",
          ),
        );
        return;
      }
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new ProviderError("ambiguous", "wallet_cli_timeout", "wallet-core command timed out"),
        );
      }, timeoutMs);
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        if (stdout.length < 1_000_000) stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        if (stderr.length < 16_000) stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new ProviderError("permanent", "wallet_cli_unavailable", error.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else
          reject(
            new ProviderError(
              "ambiguous",
              "wallet_cli_failed",
              stderr.trim().slice(0, 512) || `exit ${code}`,
            ),
          );
      });
    });
  }
}
