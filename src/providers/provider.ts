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

export type ProviderResult = Readonly<{
  state: ProviderState;
  externalOperationId?: string;
  claimUri?: string;
  errorCode?: string;
  amount?: string;
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

export interface RewardPaymentProvider {
  readonly key: string;
  verifyConfiguration(): Promise<void>;
  getBalances(): Promise<ProviderBalances>;
  createRewardOperation(input: CreateOperation): Promise<ProviderResult>;
  getOperationStatus(externalOperationId: string): Promise<ProviderResult>;
  cancelOperation(externalOperationId: string): Promise<ProviderResult>;
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
