import type { CreateOperation, ProviderResult, RewardPaymentProvider } from "./provider.js";

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

  async createRewardOperation(input: CreateOperation): Promise<ProviderResult> {
    const existing = this.effects.get(input.operationId);
    if (existing) return existing;
    const result: ProviderResult = {
      state: "ready",
      externalOperationId: `mock:${input.operationId}`,
      claimUri: `taler://pay-push/mock/${input.operationId}`,
    };
    this.effects.set(input.operationId, result);
    return result;
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
