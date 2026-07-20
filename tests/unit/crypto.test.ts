import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decrypt,
  encrypt,
  fingerprint,
  keyedHash,
  safeEqualHex,
} from "../../src/domain/crypto.js";

describe("cryptographic helpers", () => {
  it("canonicalizes object key order", () =>
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'));
  it("produces stable request fingerprints", () =>
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 })));
  it("compares hashes in constant-time API", () => {
    const hash = keyedHash("x".repeat(32), "payload");
    expect(safeEqualHex(hash, hash)).toBe(true);
    expect(safeEqualHex(hash, "0".repeat(64))).toBe(false);
  });
  it("authenticates encrypted data", () => {
    const key = Buffer.alloc(32, 7);
    const envelope = encrypt(key, "secret");
    expect(decrypt(key, envelope)).toBe("secret");
    expect(() => decrypt(Buffer.alloc(32, 8), envelope)).toThrow();
  });
  it("rejects non-canonical and truncated encrypted envelopes", () => {
    const key = Buffer.alloc(32, 7);
    const envelope = encrypt(key, "secret");
    expect(() => decrypt(key, `${envelope}=`)).toThrow();
    expect(() => decrypt(key, Buffer.alloc(20).toString("base64url"))).toThrow();
  });
});
