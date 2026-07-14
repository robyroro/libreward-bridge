import { describe, expect, it } from "vitest";
import { MockProvider } from "../../src/providers/mock-provider.js";

describe("provider contract", () => {
  it("is idempotent for concurrent duplicate operation IDs", async () => {
    const provider = new MockProvider();
    const input = {
      operationId: "op-1",
      amount: { currency: "KUDOS", value: 1n, fraction: 0 },
      summary: "Reward",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => provider.createRewardOperation(input)),
    );
    expect(new Set(results.map((result) => result.externalOperationId)).size).toBe(1);
    expect(provider.effects.size).toBe(1);
  });
  it("reconciles completion", async () => {
    const provider = new MockProvider();
    const created = await provider.createRewardOperation({
      operationId: "op-2",
      amount: { currency: "KUDOS", value: 1n, fraction: 0 },
      summary: "Reward",
      expiresAt: new Date(Date.now() + 60_000),
    });
    provider.complete(created.externalOperationId as string);
    expect((await provider.getOperationStatus(created.externalOperationId as string)).state).toBe(
      "succeeded",
    );
  });
});
