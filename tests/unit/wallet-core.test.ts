import { describe, expect, it } from "vitest";
import {
  assertSupportedWalletVersion,
  mapPeerPushDebitTransaction,
  parseWalletBalances,
} from "../../src/providers/wallet-core.js";

const id = "txn:peer-push-debit:abc";
const tx = (txState: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  type: "peer-push-debit",
  txState,
  amountRaw: "KUDOS:1",
  ...extra,
});
const uri = "taler://pay-push/exchange.example/abc";

describe("wallet-core peer-push-debit state mapping (DD037)", () => {
  it.each([
    [{ major: "pending", minor: "create-purse" }, {}, { state: "pending" }],
    [{ major: "pending", minor: "ready" }, { talerUri: uri }, { state: "ready", claimUri: uri }],
    [{ major: "pending", minor: "ready" }, {}, { state: "pending" }],
    [{ major: "finalizing" }, {}, { state: "pending" }],
    [{ major: "aborting", minor: "delete-purse" }, {}, { state: "pending" }],
    [
      { major: "suspended", minor: "ready" },
      {},
      { state: "ambiguous", errorCode: "wallet_suspended" },
    ],
    [{ major: "done" }, {}, { state: "succeeded" }],
    [{ major: "aborted" }, {}, { state: "cancelled" }],
    [{ major: "expired" }, {}, { state: "failed", errorCode: "wallet_expired" }],
    [{ major: "failed" }, {}, { state: "failed", errorCode: "wallet_failed" }],
    [{ major: "deleted" }, {}, { state: "failed", errorCode: "wallet_deleted" }],
    [
      { major: "dialog", minor: "proposed" },
      {},
      { state: "ambiguous", errorCode: "wallet_state_unexpected" },
    ],
    [{ major: "something-new" }, {}, { state: "ambiguous", errorCode: "wallet_state_unexpected" }],
  ])("maps %j", (txState, extra, expected) => {
    expect(mapPeerPushDebitTransaction(tx(txState, extra), id)).toEqual({
      externalOperationId: id,
      amount: "KUDOS:1",
      walletState: txState,
      ...expected,
    });
  });

  it("rejects malformed, foreign and mismatched transactions", () => {
    expect(() => mapPeerPushDebitTransaction({}, id)).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
    expect(() =>
      mapPeerPushDebitTransaction({ ...tx({ major: "done" }), type: "withdrawal" }, id),
    ).toThrow(expect.objectContaining({ code: "wallet_tx_type" }));
    expect(() => mapPeerPushDebitTransaction(tx({ major: "done" }), "txn:other")).toThrow(
      expect.objectContaining({ code: "wallet_tx_id_mismatch" }),
    );
    expect(() =>
      mapPeerPushDebitTransaction(
        tx({ major: "pending", minor: "ready" }, { talerUri: "https://x" }),
        id,
      ),
    ).toThrow(expect.objectContaining({ code: "wallet_uri_scheme" }));
  });
});

describe("wallet-core version gate and balances", () => {
  it("accepts only verified versions", () => {
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.12", version: "7:0:0" }),
    ).not.toThrow();
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.48", version: "10:0:0" }),
    ).toThrow(expect.objectContaining({ code: "wallet_version_unsupported" }));
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.12", version: "10:0:0" }),
    ).toThrow(expect.objectContaining({ code: "wallet_api_version_unsupported" }));
    expect(() => assertSupportedWalletVersion({ implementationSemver: 12 })).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });

  it("parses balances", () => {
    expect(
      parseWalletBalances({
        balances: [
          {
            scopeInfo: { currency: "KUDOS" },
            available: "KUDOS:25",
            pendingIncoming: "KUDOS:1",
            pendingOutgoing: "KUDOS:2",
            disablePeerPayments: true,
          },
        ],
        haveProdBalance: false,
      }),
    ).toEqual({
      balances: [
        {
          currency: "KUDOS",
          available: "KUDOS:25",
          pendingIncoming: "KUDOS:1",
          pendingOutgoing: "KUDOS:2",
          peerPaymentsAllowed: false,
        },
      ],
      haveProductionBalance: false,
    });
    expect(() => parseWalletBalances({ balances: [{}] })).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });
});
