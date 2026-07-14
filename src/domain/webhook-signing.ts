import { keyedHash, safeEqualHex } from "./crypto.js";

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${keyedHash(secret, `${timestamp}.${body}`)}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  if (!/^\d{10,}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds)
    return false;
  const supplied = /^v1=([a-f0-9]{64})$/i.exec(signature)?.[1];
  return supplied ? safeEqualHex(supplied, signWebhook(secret, timestamp, body).slice(3)) : false;
}
