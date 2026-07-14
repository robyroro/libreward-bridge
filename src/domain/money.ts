import { z } from "zod";

const AMOUNT_RE = /^([A-Z][A-Z0-9]{0,11}):([0-9]+)(?:\.([0-9]{1,8}))?$/;

export type Money = Readonly<{ currency: string; value: bigint; fraction: number }>;

export function parseAmount(
  input: string,
  supported: ReadonlySet<string>,
  maxValue: number,
): Money {
  const money = parseTalerAmount(input, supported, maxValue);
  if (money.value === 0n && money.fraction === 0) throw new Error("reward amount must be positive");
  return money;
}

export function parseBalanceAmount(
  input: string,
  supported: ReadonlySet<string>,
  maxValue = Number.MAX_SAFE_INTEGER,
): Money {
  return parseTalerAmount(input, supported, maxValue);
}

function parseTalerAmount(input: string, supported: ReadonlySet<string>, maxValue: number): Money {
  const match = AMOUNT_RE.exec(input);
  if (!match?.[1] || !match[2])
    throw new Error("amount must use TALER CURRENCY:value[.fraction] syntax");
  const currency = match[1];
  if (!supported.has(currency)) throw new Error(`currency ${currency} is not configured`);
  const value = BigInt(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(8, "0"));
  if (value > BigInt(maxValue)) throw new Error("reward amount exceeds configured maximum");
  return Object.freeze({ currency, value, fraction });
}

export function amountAtoms(money: Money): bigint {
  return money.value * 100_000_000n + BigInt(money.fraction);
}

export function serializeAmount(money: Money): string {
  const digits = money.fraction.toString().padStart(8, "0").replace(/0+$/, "");
  return `${money.currency}:${money.value.toString()}${digits ? `.${digits}` : ""}`;
}

export const amountSchema = z.string().min(3).max(64);
