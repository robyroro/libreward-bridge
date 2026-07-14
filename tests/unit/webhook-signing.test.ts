import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhookSignature } from "../../src/domain/webhook-signing.js";

describe("webhook signing", () => {
  it("verifies a fresh signature and rejects replay/tampering", () => {
    const now = 1_800_000_000;
    const timestamp = String(now);
    const signature = signWebhook("s".repeat(32), timestamp, '{"ok":true}');
    expect(verifyWebhookSignature("s".repeat(32), timestamp, '{"ok":true}', signature, now)).toBe(
      true,
    );
    expect(verifyWebhookSignature("s".repeat(32), timestamp, '{"ok":false}', signature, now)).toBe(
      false,
    );
    expect(
      verifyWebhookSignature("s".repeat(32), timestamp, '{"ok":true}', signature, now + 301),
    ).toBe(false);
  });
});
