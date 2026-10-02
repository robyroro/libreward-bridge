import type { Money } from "../domain/money.js";

export type ProviderState =
  | "ready"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "ambiguous";

export type CreateOperation = Readonly<{
  operationId: string;
  amount: Money;
  summary: string;
  expiresAt: Date;
}>;

export type WalletState = Readonly<{ major: string; minor?: string }>;

export type ProviderResult = Readonly<{
  state: ProviderState;
  externalOperationId?: string;
  claimUri?: string;
  errorCode?: string;
  amount?: string;
  walletState?: WalletState;
}>;

export type ProviderBalance = Readonly<{
  currency: string;
  available: string;
  pendingIncoming: string;
  pendingOutgoing: string;
  peerPaymentsAllowed: boolean;
}>;

export type ProviderBalances = Readonly<{
  balances: readonly ProviderBalance[];
  haveProductionBalance: boolean;
}>;

export type PreflightResult = Readonly<{
  amountEffective: string;
  exchangeBaseUrl?: string;
  quote?: string;
}>;

export interface RewardPaymentProvider {
  readonly key: string;
  verifyConfiguration(): Promise<void>;
  getBalances(): Promise<ProviderBalances>;
  /** Read-only feasibility check; must not create any external effect. */
  preflight(input: CreateOperation): Promise<PreflightResult>;
  /** Creates the external payout and returns its ID. Never retried automatically. */
  initiate(input: CreateOperation, preflight: PreflightResult): Promise<string>;
  /** Read-only wait until the operation is shareable or terminal. */
  waitUntilShareable(externalOperationId: string): Promise<ProviderResult>;
  getOperationStatus(externalOperationId: string): Promise<ProviderResult>;
  cancelOperation(externalOperationId: string): Promise<ProviderResult>;
  /** Optional push signal that an external operation may have changed state. */
  onOperationUpdate?(listener: (externalOperationId: string) => void): () => void;
  close?(): void;
}

export class ProviderError extends Error {
  constructor(
    public readonly classification: "transient" | "permanent" | "ambiguous",
    public readonly code: string,
    message: string,
    public readonly externalOperationId?: string,
  ) {
    super(message);
  }
}
