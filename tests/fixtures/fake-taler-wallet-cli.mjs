const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("test-wallet 1.0.0\n");
  process.exit(0);
}

if (args.includes("run-until-done")) {
  process.stderr.write("provider must not wait for the recipient claim\n");
  process.exit(9);
}

const apiIndex = args.indexOf("api");
const operation = apiIndex >= 0 ? args[apiIndex + 1] : undefined;
const walletDb = args.find((arg) => arg.startsWith("--wallet-db=")) ?? "";
const response = (result) => ({ type: "response", operation, id: "fixture", result });

if (operation === "initiatePeerPushDebit" && walletDb.includes("timeout-wallet")) {
  setTimeout(() => undefined, 5_000);
} else if (operation === "initiatePeerPushDebit" && walletDb.includes("error-wallet")) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      operation,
      id: "fixture",
      error: { code: 7012, hint: "insufficient balance" },
    }),
  );
} else
  switch (operation) {
    case "getVersion":
      process.stdout.write(JSON.stringify(response({ implementationSemver: "1.0.0" })));
      break;
    case "getBalances":
      process.stdout.write(
        JSON.stringify(
          response({
            balances: [
              {
                scopeInfo: { currency: "KUDOS" },
                available: "KUDOS:25",
                pendingIncoming: "KUDOS:1",
                pendingOutgoing: "KUDOS:2",
                disablePeerPayments: false,
              },
            ],
            haveProdBalance: false,
          }),
        ),
      );
      break;
    case "initiatePeerPushDebit":
      process.stdout.write(
        JSON.stringify(response({ transactionId: "txn:peer-push-debit:fixture" })),
      );
      break;
    case "testingWaitTransactionState":
      process.stdout.write(
        JSON.stringify(response({ transactionId: "txn:peer-push-debit:fixture" })),
      );
      break;
    case "getTransactionById":
      process.stdout.write(
        JSON.stringify(
          response({
            transactionId: "txn:peer-push-debit:fixture",
            type: "peer-push-debit",
            txState: walletDb.includes("expired-wallet")
              ? { major: "expired" }
              : { major: "pending", minor: "ready" },
            ...(walletDb.includes("expired-wallet")
              ? {}
              : { talerUri: "taler://pay-push/exchange.example/fixture" }),
            amountRaw: "KUDOS:1",
          }),
        ),
      );
      break;
    case "abortTransaction":
      process.stdout.write(JSON.stringify(response({})));
      break;
    default:
      process.stderr.write(`unsupported fixture operation: ${operation ?? "none"}\n`);
      process.exitCode = 2;
  }
