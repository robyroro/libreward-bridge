import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function keyedHash(secret: string | Buffer, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return createHmac("sha256", "libreward-request-fingerprint-v1")
    .update(canonicalJson(value))
    .digest("hex");
}

export function encrypt(key: Buffer, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decrypt(key: Buffer, envelope: string): string {
  const [version, nonceEncoded, tagEncoded, ciphertextEncoded] = envelope.split(".");
  if (version !== "v1" || !nonceEncoded || !tagEncoded || !ciphertextEncoded)
    throw new Error("invalid encrypted envelope");
  try {
    const nonce = decodeCanonicalBase64Url(nonceEncoded);
    const tag = decodeCanonicalBase64Url(tagEncoded);
    const ciphertext = decodeCanonicalBase64Url(ciphertextEncoded);
    if (key.length !== 32 || nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0)
      throw new Error("invalid encrypted envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("invalid encrypted envelope");
  }
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("non-canonical base64url");
  return decoded;
}
