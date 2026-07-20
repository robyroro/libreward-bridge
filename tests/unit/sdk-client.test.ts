import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type LibreRewardApiError,
  LibreRewardClient,
  verifyWebhookSignature,
} from "../../sdk/typescript/client.js";

const apiKey = `lrk_abcdefgh.${"x".repeat(32)}`;

describe("TypeScript SDK", () => {
  it("sends authenticated idempotent requests and encodes path segments", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({ id: "rw_fixture", claim_url: "https://bridge.test/claim/redacted" }),
      );
    const client = new LibreRewardClient({ baseUrl: "https://bridge.test/base/", apiKey, fetch });
    await client.createReward("attempt:1", { amount: "KUDOS:1", description: "Test reward" });
    await client.getReward("rw/unsafe");

    const [createUrl, createInit] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(createUrl.href).toBe("https://bridge.test/base/v1/rewards");
    expect(new Headers(createInit.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(new Headers(createInit.headers).get("idempotency-key")).toBe("attempt:1");
    expect(fetch.mock.calls[1]?.[0].toString()).toContain("rw%2Funsafe");
  });

  it("returns structured API errors without following redirects", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "idempotency_conflict", message: "Conflict", request_id: "req_1" } },
          { status: 409 },
        ),
      );
    const client = new LibreRewardClient({ baseUrl: "https://bridge.test", apiKey, fetch });
    await expect(client.getReward("rw_fixture")).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        code: "idempotency_conflict",
        requestId: "req_1",
      }) as LibreRewardApiError,
    );
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("verifies webhook signatures within a bounded replay window", () => {
    const timestamp = "1700000000";
    const rawBody = '{"id":"evt_fixture"}';
    const secret = "whsec_fixture";
    const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        rawBody,
        signature,
        nowSeconds: 1_700_000_001,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        rawBody,
        signature,
        nowSeconds: 1_700_001_000,
      }),
    ).toBe(false);
  });
});
