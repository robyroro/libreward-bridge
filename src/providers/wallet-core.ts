import { amountAtoms, type Money, parseBalanceAmount, serializeAmount } from "../domain/money.js";
import {
  type CreateOperation,
  type PreflightResult,
  type ProviderBalances,
  ProviderError,
  type ProviderResult,
} from "./provider.js";

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

export function peerPushCheckRequest(
  input: CreateOperation,
  exchangeBaseUrl?: string,
): Record<string, unknown> {
  return {
    amount: serializeAmount(input.amount),
    ...(exchangeBaseUrl ? { exchangeBaseUrl } : {}),
  };
}

/** Interprets `checkPeerPushDebit` (wallet API 7:0:0; `peerPushDebitQuote` from 10:0:0). */
export function parsePeerPushCheck(response: unknown, input: CreateOperation): PreflightResult {
  if (!isObject(response)) throw malformedResponse("wallet check response is malformed");
  if (response.type === "insufficient-balance")
    // Nothing was created, so a later retry is safe.
    throw new ProviderError(
      "transient",
      "wallet_insufficient_balance",
      "wallet balance is insufficient for the reward",
    );
  const { amountRaw, amountEffective, exchangeBaseUrl, maxExpirationDate, peerPushDebitQuote } =
    response;
  if (
    response.type !== "ok" ||
    typeof amountRaw !== "string" ||
    typeof amountEffective !== "string" ||
    typeof exchangeBaseUrl !== "string" ||
    !isObject(maxExpirationDate)
  )
    throw malformedResponse("wallet check response is malformed");
  const currencies = new Set([input.amount.currency]);
  let raw: Money;
  let effective: Money;
  try {
    raw = parseBalanceAmount(amountRaw, currencies);
    effective = parseBalanceAmount(amountEffective, currencies);
  } catch {
    throw malformedResponse("wallet check amounts are malformed");
  }
  if (amountAtoms(raw) !== amountAtoms(input.amount))
    throw new ProviderError(
      "permanent",
      "provider_amount_mismatch",
      "wallet check amount did not match reward",
    );
  if (amountAtoms(effective) < amountAtoms(raw))
    throw malformedResponse("wallet effective amount is below the raw amount");
  const maxSeconds = maxExpirationDate.t_s;
  if (typeof maxSeconds !== "number" && maxSeconds !== "never")
    throw malformedResponse("wallet maximum expiration is malformed");
  if (typeof maxSeconds === "number" && maxSeconds < Math.floor(input.expiresAt.getTime() / 1000))
    throw new ProviderError(
      "permanent",
      "wallet_expiration_too_late",
      "reward expiry exceeds the wallet's maximum purse expiration",
    );
  return {
    amountEffective: serializeAmount(effective),
    exchangeBaseUrl,
    ...(typeof peerPushDebitQuote === "string" ? { quote: peerPushDebitQuote } : {}),
  };
}

export function peerPushInitiateRequest(
  input: CreateOperation,
  preflight: PreflightResult,
  exchangeBaseUrl?: string,
): Record<string, unknown> {
  // Pin the exchange the check selected; forward the quote so newer wallets reject drift.
  const exchange = preflight.exchangeBaseUrl ?? exchangeBaseUrl;
  return {
    ...(exchange ? { exchangeBaseUrl: exchange } : {}),
    ...(preflight.quote ? { peerPushDebitQuote: preflight.quote } : {}),
    partialContractTerms: {
      amount: serializeAmount(input.amount),
      summary: input.summary,
      purse_expiration: { t_s: Math.floor(input.expiresAt.getTime() / 1000) },
    },
  };
}

export function parseInitiation(result: unknown): string {
  if (
    !isObject(result) ||
    typeof result.transactionId !== "string" ||
    !result.transactionId.startsWith("txn:peer-push-debit:")
  )
    throw malformedResponse("wallet initiation response is malformed");
  return result.transactionId;
}

/** Returns the transaction ID of a `transaction-state-transition` notification, if any. */
export function transitionTransactionId(notification: unknown): string | undefined {
  return isObject(notification) &&
    notification.type === "transaction-state-transition" &&
    typeof notification.transactionId === "string"
    ? notification.transactionId
    : undefined;
}
