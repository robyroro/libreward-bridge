import { describe, expect, it } from "vitest";
import {
  amountAtoms,
  parseAmount,
  parseBalanceAmount,
  serializeAmount,
} from "../../src/domain/money.js";

const currencies = new Set(["EUR", "KUDOS", "JPY"]);
describe("Taler money", () => {
  it.each([
    ["EUR:1", "EUR:1"],
    ["KUDOS:0.00000001", "KUDOS:0.00000001"],
    ["JPY:42.12000000", "JPY:42.12"],
  ])("parses and canonicalizes %s", (input, expected) => {
    expect(serializeAmount(parseAmount(input, currencies, 1000))).toBe(expected);
  });
  it.each(["EUR:-1", "eur:1", "EUR:1.000000001", "EUR:0", "BTC:1", "EUR:1001"])(
    "rejects %s",
    (amount) => {
      expect(() => parseAmount(amount, currencies, 1000)).toThrow();
    },
  );
  it("accepts zero wallet balances and converts exact atoms", () => {
    expect(parseBalanceAmount("KUDOS:0", currencies)).toEqual({
      currency: "KUDOS",
      value: 0n,
      fraction: 0,
    });
    expect(amountAtoms(parseBalanceAmount("KUDOS:2.00000001", currencies))).toBe(200000001n);
  });
});
