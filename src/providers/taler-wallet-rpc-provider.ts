import {
  type CreateOperation,
  type PreflightResult,
  ProviderError,
  type ProviderResult,
  type RewardPaymentProvider,
} from "./provider.js";
import {
  assertSupportedWalletVersion,
  mapPeerPushDebitTransaction,
  parseInitiation,
  parsePeerPushCheck,
  parseWalletBalances,
  peerPushCheckRequest,
  peerPushInitiateRequest,
  transitionTransactionId,
} from "./wallet-core.js";
import { WalletCoreError, WalletRpcClient, WalletRpcError } from "./wallet-rpc/client.js";

type RpcOptions = Readonly<{
  TALER_WALLET_CONNECTION: string;
  TALER_WALLET_COMMAND_TIMEOUT_MS: number;
  TALER_EXCHANGE_BASE_URL?: string | undefined;
}>;

type Tuning = Readonly<{ safetyPollMs?: number; maxBackoffMs?: number }>;

/** Reward provider over one persistent connection to `taler-wallet-cli advanced serve`. */
export class TalerWalletRpcProvider implements RewardPaymentProvider {
  readonly key = "taler-wallet-rpc";
  private readonly client: WalletRpcClient;
  private readonly safetyPollMs: number;

  constructor(
    private readonly options: RpcOptions,
    tuning: Tuning = {},
  ) {
    if (!options.TALER_WALLET_CONNECTION)
      throw new ProviderError(
        "permanent",
        "wallet_connection_required",
        "taler-wallet-rpc requires TALER_WALLET_CONNECTION",
      );
    this.client = new WalletRpcClient({
      socketPath: options.TALER_WALLET_CONNECTION,
      requestTimeoutMs: options.TALER_WALLET_COMMAND_TIMEOUT_MS,
      ...(tuning.maxBackoffMs === undefined ? {} : { maxBackoffMs: tuning.maxBackoffMs }),
    });
    this.safetyPollMs = tuning.safetyPollMs ?? 5_000;
  }

  async verifyConfiguration(): Promise<void> {
    assertSupportedWalletVersion(await this.read("getVersion", {}));
  }

  async getBalances() {
    return parseWalletBalances(await this.read("getBalances", {}));
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    return parsePeerPushCheck(
      await this.read("checkPeerPushDebit", peerPushCheckRequest(input, this.exchangeBaseUrl())),
      input,
    );
  }

  async initiate(input: CreateOperation, preflight: PreflightResult): Promise<string> {
    const result = await this.write(
      "initiatePeerPushDebit",
      peerPushInitiateRequest(input, preflight, this.exchangeBaseUrl()),
    );
    try {
      return parseInitiation(result);
    } catch {
      throw new ProviderError(
        "ambiguous",
        "wallet_rpc_initiate_unknown",
        "wallet-core initiation response is malformed",
      );
    }
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    let signalled = false;
    let wake: () => void = () => undefined;
    const signal = () => {
      signalled = true;
      wake();
    };
    // Subscribe before the first read so a transition between read and wait is not lost.
    const unsubscribeNotification = this.client.onNotification((notification) => {
      if (transitionTransactionId(notification) === externalOperationId) signal();
    });
    const unsubscribeConnection = this.client.onConnectionChange(signal);
    const deadline = Date.now() + this.options.TALER_WALLET_COMMAND_TIMEOUT_MS;
    try {
      for (;;) {
        signalled = false;
        const result = await this.getOperationStatus(externalOperationId);
        if (result.state !== "pending") return result;
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new ProviderError(
            "ambiguous",
            "wallet_readiness_timeout",
            "wallet transaction did not become shareable before the readiness timeout",
            externalOperationId,
          );
        if (!signalled)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(remaining, this.safetyPollMs));
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        wake = () => undefined;
      }
    } finally {
      unsubscribeNotification();
      unsubscribeConnection();
    }
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    return mapPeerPushDebitTransaction(
      await this.read("getTransactionById", { transactionId: externalOperationId }),
      externalOperationId,
    );
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    await this.write("abortTransaction", { transactionId: externalOperationId });
    return { state: "cancelled", externalOperationId };
  }

  onOperationUpdate(listener: (externalOperationId: string) => void): () => void {
    return this.client.onNotification((notification) => {
      const transactionId = transitionTransactionId(notification);
      if (transactionId?.startsWith("txn:peer-push-debit:")) listener(transactionId);
    });
  }

  close(): void {
    this.client.close();
  }

  private exchangeBaseUrl(): string | undefined {
    return this.options.TALER_EXCHANGE_BASE_URL || undefined;
  }

  private async read(operation: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.request(operation, args);
    } catch (error) {
      throw classify(error, "read");
    }
  }

  private async write(operation: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.request(operation, args);
    } catch (error) {
      throw classify(error, "write");
    }
  }
}

/**
 * A write whose request may have reached wallet-core is ambiguous and is never retried
 * automatically; `wallet_rpc_unavailable` means nothing was sent. Reads are safe to retry.
 */
function classify(error: unknown, kind: "read" | "write"): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof WalletCoreError)
    return new ProviderError("permanent", `taler_${error.talerCode ?? "unknown"}`, error.hint);
  if (error instanceof WalletRpcError) {
    if (error.code === "wallet_rpc_unavailable")
      return new ProviderError("transient", error.code, error.message);
    if (kind === "write") return new ProviderError("ambiguous", error.code, error.message);
    return new ProviderError(
      error.code === "wallet_rpc_protocol" ? "permanent" : "transient",
      error.code,
      error.message,
    );
  }
  return new ProviderError(
    kind === "write" ? "ambiguous" : "transient",
    "wallet_rpc_unknown",
    "wallet-core outcome is unknown",
  );
}
