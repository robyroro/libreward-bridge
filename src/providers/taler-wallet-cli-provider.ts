import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
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

type WalletVersion = {
  implementationSemver: string;
  version: string;
};

const supportedWalletVersions = new Set(["1.6.10", "1.6.12"]);
const supportedWalletApiVersion = "7:0:0";

type CliOptions = Pick<
  Config,
  | "TALER_WALLET_CLI"
  | "TALER_WALLET_CLI_NODE_SCRIPT"
  | "TALER_WALLET_CRYPTO_WORKER"
  | "TALER_WALLET_COMMAND_TIMEOUT_MS"
  | "TALER_WALLET_DB"
  | "TALER_EXCHANGE_BASE_URL"
> &
  Partial<Pick<Config, "TALER_WALLET_CONNECTION" | "TALER_WALLET_ALLOW_TESTING_API">>;

export class TalerWalletCliProvider implements RewardPaymentProvider {
  readonly key = "taler-wallet-cli";
  constructor(private readonly options: CliOptions) {}

  async verifyConfiguration(): Promise<void> {
    await this.run(["--version"], 10_000);
    const version = await this.api<WalletVersion>("getVersion", {});
    if (
      !isObject(version) ||
      typeof version.implementationSemver !== "string" ||
      typeof version.version !== "string"
    )
      throw malformedResponse("wallet version response is malformed");
    const semanticVersion = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(version.implementationSemver)?.[1];
    if (!semanticVersion || !supportedWalletVersions.has(semanticVersion)) {
      throw new ProviderError(
        "permanent",
        "wallet_version_unsupported",
        `wallet-core ${version.implementationSemver} is unsupported; supported versions are ${[...supportedWalletVersions].join(", ")}`,
      );
    }
    if (version.version !== supportedWalletApiVersion)
      throw new ProviderError(
        "permanent",
        "wallet_api_version_unsupported",
        `wallet API ${String(version.version)} is unsupported; expected ${supportedWalletApiVersion}`,
      );
    if (!this.options.TALER_WALLET_CONNECTION && !this.options.TALER_WALLET_ALLOW_TESTING_API)
      throw new ProviderError(
        "permanent",
        "wallet_connection_required",
        "a persistent wallet RPC connection is required",
      );
  }

  async getBalances() {
    const result = await this.api<WalletBalances>("getBalances", {});
    if (!isObject(result) || !Array.isArray(result.balances))
      throw malformedResponse("wallet balances response is malformed");
    return {
      balances: result.balances.map((balance) => {
        if (
          !isObject(balance) ||
          !isObject(balance.scopeInfo) ||
          typeof balance.scopeInfo.currency !== "string" ||
          typeof balance.available !== "string" ||
          typeof balance.pendingIncoming !== "string" ||
          typeof balance.pendingOutgoing !== "string"
        )
          throw malformedResponse("wallet balance entry is malformed");
        return {
          currency: balance.scopeInfo.currency,
          available: balance.available,
          pendingIncoming: balance.pendingIncoming,
          pendingOutgoing: balance.pendingOutgoing,
          peerPaymentsAllowed: balance.disablePeerPayments !== true,
        };
      }),
      haveProductionBalance: result.haveProdBalance === true,
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
      if (!isObject(initiated) || typeof initiated.transactionId !== "string")
        throw malformedResponse("wallet initiation response is malformed");
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.classification === "ambiguous" || error.code.startsWith("taler_"))
      )
        throw error;
      throw new ProviderError(
        "ambiguous",
        "wallet_cli_initiate_unknown",
        "wallet-core initiation outcome is unknown",
      );
    }
    try {
      return await this.waitUntilShareable(initiated.transactionId);
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError("ambiguous", "wallet_status_unknown", "wallet status is unknown");
      throw new ProviderError(
        "ambiguous",
        providerError.code,
        providerError.message,
        initiated.transactionId,
      );
    }
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    const tx = await this.api<Transaction>("getTransactionById", {
      transactionId: externalOperationId,
    });
    if (
      !isObject(tx) ||
      typeof tx.transactionId !== "string" ||
      typeof tx.type !== "string" ||
      !isObject(tx.txState) ||
      typeof tx.txState.major !== "string" ||
      typeof tx.amountRaw !== "string"
    )
      throw malformedResponse("wallet transaction response is malformed");
    if (tx.type !== "peer-push-debit")
      throw new ProviderError(
        "permanent",
        "wallet_tx_type",
        "wallet transaction is not peer-push-debit",
      );
    if (tx.transactionId !== externalOperationId)
      throw new ProviderError(
        "permanent",
        "wallet_tx_id_mismatch",
        "wallet returned a different transaction ID",
      );
    if (
      tx.talerUri &&
      (tx.talerUri.length > 4096 || !/^taler:\/\/pay-push\/\S+$/.test(tx.talerUri))
    )
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

  private async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    if (!this.options.TALER_WALLET_CONNECTION) {
      // Compatibility path for the verified 1.6.10 sandbox evidence only. The operation name is
      // deliberately isolated here: it is a GNU Taler testing API and is never allowed by the
      // production configuration. A timeout occurs after initiation, so the known transaction ID
      // must be retained for reconciliation and initiation must never be repeated automatically.
      await this.api("testingWaitTransactionState", {
        transactionId: externalOperationId,
        txState: [
          { major: "pending", minor: "ready" },
          { major: "done" },
          { major: "failed", minor: "*" },
          { major: "aborted", minor: "*" },
        ],
      });
      return this.getOperationStatus(externalOperationId);
    }

    const deadline = Date.now() + this.options.TALER_WALLET_COMMAND_TIMEOUT_MS;
    for (;;) {
      const result = await this.getOperationStatus(externalOperationId);
      if (result.state !== "pending") return result;
      if (Date.now() >= deadline)
        throw new ProviderError(
          "ambiguous",
          "wallet_readiness_timeout",
          "wallet transaction did not become shareable before the readiness timeout",
          externalOperationId,
        );
      await delay(100);
    }
  }

  private async api<T>(operation: string, request: Record<string, unknown>): Promise<T> {
    const stdout = await this.run(
      ["api", operation, JSON.stringify(request)],
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
      if (isObject(parsed) && parsed.type === "error") {
        const detail = parsed as {
          error?: { code?: number; talerErrorCode?: number; hint?: string; message?: string };
        };
        throw new ProviderError(
          "permanent",
          `taler_${detail.error?.code ?? detail.error?.talerErrorCode ?? "unknown"}`,
          detail.error?.hint ?? detail.error?.message ?? "wallet-core error",
        );
      }
      if (isObject(parsed) && parsed.type === "response") {
        if (!("result" in parsed))
          throw malformedResponse("wallet response envelope has no result");
        return parsed.result as T;
      }
      if (isObject(parsed) && typeof parsed.type === "string")
        throw malformedResponse("wallet response envelope type is unsupported");
      return parsed as T;
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
      const walletTarget = this.options.TALER_WALLET_CONNECTION
        ? [`--wallet-connection=${this.options.TALER_WALLET_CONNECTION}`]
        : [`--wallet-db=${this.options.TALER_WALLET_DB}`];
      const globalArgs = [
        ...(cryptoWorker ? [`--crypto-worker=${cryptoWorker}`] : []),
        ...walletTarget,
      ];
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
              stderr.trim()
                ? "wallet CLI reported an error"
                : `wallet CLI exited with code ${code}`,
            ),
          );
      });
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function malformedResponse(message: string): ProviderError {
  return new ProviderError("permanent", "wallet_cli_malformed_response", message);
}
