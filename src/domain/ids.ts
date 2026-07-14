import { randomBytes, randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function publicId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
