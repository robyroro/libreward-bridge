import { type ProviderBalances, ProviderError, type ProviderResult } from "./provider.js";

// Exact versions verified against official source and valueless sandbox evidence.
export const supportedWalletVersions: ReadonlySet<string> = new Set(["1.6.10", "1.6.12"]);
export const supportedWalletApiVersion = "7:0:0";

const peerPushUri = /^taler:\/\/pay-push\/\S+$/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function malformedResponse(message: string): ProviderError {
  return new ProviderError("permanent", "wallet_malformed_response", message);
}

export function assertSupportedWalletVersion(version: unknown): void {
  if (!isObject(version)) throw malformedResponse("wallet version response is malformed");
  const implementation = version.implementationSemver;
  const api = version.version;
  if (typeof implementation !== "string" || typeof api !== "string")
    throw malformedResponse("wallet version response is malformed");
  const semanticVersion = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(implementation)?.[1];
  if (!semanticVersion || !supportedWalletVersions.has(semanticVersion))
    throw new ProviderError(
      "permanent",
      "wallet_version_unsupported",
      `wallet-core ${implementation} is unsupported; supported versions are ${[...supportedWalletVersions].join(", ")}`,
    );
  if (api !== supportedWalletApiVersion)
    throw new ProviderError(
      "permanent",
      "wallet_api_version_unsupported",
      `wallet API ${api} is unsupported; expected ${supportedWalletApiVersion}`,
    );
}

export function parseWalletBalances(result: unknown): ProviderBalances {
  if (!isObject(result) || !Array.isArray(result.balances))
    throw malformedResponse("wallet balances response is malformed");
  return {
    balances: result.balances.map((balance: unknown) => {
      if (!isObject(balance) || !isObject(balance.scopeInfo))
        throw malformedResponse("wallet balance entry is malformed");
      const { currency } = balance.scopeInfo;
      const { available, pendingIncoming, pendingOutgoing } = balance;
      if (
        typeof currency !== "string" ||
        typeof available !== "string" ||
        typeof pendingIncoming !== "string" ||
        typeof pendingOutgoing !== "string"
      )
        throw malformedResponse("wallet balance entry is malformed");
      return {
        currency,
        available,
        pendingIncoming,
        pendingOutgoing,
        peerPaymentsAllowed: balance.disablePeerPayments !== true,
      };
    }),
    haveProductionBalance: result.haveProdBalance === true,
  };
}

/**
 * Maps a wallet-core peer-push-debit transaction to a provider result using the states of
 * GNU Taler design document 037. Anything not listed there fails closed as ambiguous.
 */
export function mapPeerPushDebitTransaction(
  tx: unknown,
  externalOperationId: string,
): ProviderResult {
  if (!isObject(tx) || !isObject(tx.txState))
    throw malformedResponse("wallet transaction response is malformed");
  const { transactionId, type, amountRaw, talerUri } = tx;
  const { major, minor } = tx.txState;
  if (
    typeof transactionId !== "string" ||
    typeof type !== "string" ||
    typeof major !== "string" ||
    typeof amountRaw !== "string"
  )
    throw malformedResponse("wallet transaction response is malformed");
  if (type !== "peer-push-debit")
    throw new ProviderError(
      "permanent",
      "wallet_tx_type",
      "wallet transaction is not peer-push-debit",
    );
  if (transactionId !== externalOperationId)
    throw new ProviderError(
      "permanent",
      "wallet_tx_id_mismatch",
      "wallet returned a different transaction ID",
    );
  if (
    talerUri !== undefined &&
    (typeof talerUri !== "string" || talerUri.length > 4096 || !peerPushUri.test(talerUri))
  )
    throw new ProviderError(
      "permanent",
      "wallet_uri_scheme",
      "wallet returned a non peer-push URI",
    );
  const base = {
    externalOperationId,
    amount: amountRaw,
    walletState: typeof minor === "string" ? { major, minor } : { major },
  };
  switch (major) {
    case "done":
      return { ...base, state: "succeeded" };
    case "aborted":
      return { ...base, state: "cancelled" };
    case "expired":
    case "failed":
    case "deleted":
      return { ...base, state: "failed", errorCode: `wallet_${major}` };
    case "pending":
      return minor === "ready" && typeof talerUri === "string"
        ? { ...base, state: "ready", claimUri: talerUri }
        : { ...base, state: "pending" };
    case "finalizing":
    case "aborting":
      return { ...base, state: "pending" };
    case "suspended":
      return { ...base, state: "ambiguous", errorCode: "wallet_suspended" };
    default:
      return { ...base, state: "ambiguous", errorCode: "wallet_state_unexpected" };
  }
}
