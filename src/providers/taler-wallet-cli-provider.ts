import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "../config.js";
import {
  type CreateOperation,
  type PreflightResult,
  ProviderError,
  type ProviderResult,
  type RewardPaymentProvider,
} from "./provider.js";
import {
  assertSupportedWalletVersion,
  isObject,
  malformedResponse,
  mapPeerPushDebitTransaction,
  parseInitiation,
  parsePeerPushCheck,
  parseWalletBalances,
  peerPushCheckRequest,
  peerPushInitiateRequest,
} from "./wallet-core.js";

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
    assertSupportedWalletVersion(await this.api("getVersion", {}));
    if (!this.options.TALER_WALLET_CONNECTION && !this.options.TALER_WALLET_ALLOW_TESTING_API)
      throw new ProviderError(
        "permanent",
        "wallet_connection_required",
        "a persistent wallet RPC connection is required",
      );
  }

  async getBalances() {
    return parseWalletBalances(await this.api("getBalances", {}));
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    try {
      return parsePeerPushCheck(
        await this.api("checkPeerPushDebit", peerPushCheckRequest(input, this.exchangeBaseUrl())),
        input,
      );
    } catch (error) {
      // checkPeerPushDebit is read-only: an unknown CLI outcome cannot have created a payout.
      if (error instanceof ProviderError && error.classification === "ambiguous")
        throw new ProviderError("transient", error.code, error.message);
      throw error;
    }
  }

  async initiate(input: CreateOperation, preflight: PreflightResult): Promise<string> {
    try {
      return parseInitiation(
        await this.api(
          "initiatePeerPushDebit",
          peerPushInitiateRequest(input, preflight, this.exchangeBaseUrl()),
        ),
      );
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
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    if (!this.options.TALER_WALLET_CONNECTION) {
      // Compatibility path for the verified 1.6.10 sandbox evidence only. The operation name is
      // deliberately isolated here: it is a GNU Taler testing API and is never allowed by the
      // production configuration. Upstream confirmed on 2026-07-14 that it is not deprecated.
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

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    return mapPeerPushDebitTransaction(
      await this.api("getTransactionById", { transactionId: externalOperationId }),
      externalOperationId,
    );
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    await this.api("abortTransaction", { transactionId: externalOperationId });
    return { state: "cancelled", externalOperationId };
  }

  private exchangeBaseUrl(): string | undefined {
    return this.options.TALER_EXCHANGE_BASE_URL || undefined;
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
