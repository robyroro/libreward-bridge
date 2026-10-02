import { serializeAmount } from "../domain/money.js";
import type {
  CreateOperation,
  PreflightResult,
  ProviderResult,
  RewardPaymentProvider,
} from "./provider.js";

export class MockProvider implements RewardPaymentProvider {
  readonly key = "mock";
  readonly effects = new Map<string, ProviderResult>();

  async verifyConfiguration(): Promise<void> {}

  async getBalances() {
    return {
      balances: [
        {
          currency: "KUDOS",
          available: "KUDOS:1000000",
          pendingIncoming: "KUDOS:0",
          pendingOutgoing: "KUDOS:0",
          peerPaymentsAllowed: true,
        },
      ],
      haveProductionBalance: false,
    };
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    return { amountEffective: serializeAmount(input.amount) };
  }

  async initiate(input: CreateOperation): Promise<string> {
    const existing = this.effects.get(input.operationId)?.externalOperationId;
    if (existing) return existing;
    const externalOperationId = `mock:${input.operationId}`;
    this.effects.set(input.operationId, {
      state: "ready",
      externalOperationId,
      claimUri: `taler://pay-push/mock/${input.operationId}`,
    });
    return externalOperationId;
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    return this.getOperationStatus(externalOperationId);
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    const result = [...this.effects.values()].find(
      (item) => item.externalOperationId === externalOperationId,
    );
    return result ?? { state: "failed", errorCode: "mock_not_found" };
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    return { state: "cancelled", externalOperationId };
  }

  complete(externalOperationId: string): void {
    for (const [key, result] of this.effects) {
      if (result.externalOperationId === externalOperationId)
        this.effects.set(key, { ...result, state: "succeeded" });
    }
  }
}
