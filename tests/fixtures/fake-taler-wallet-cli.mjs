const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("test-wallet 1.6.12\n");
  process.exit(0);
}

if (args.includes("run-until-done")) {
  process.stderr.write("provider must not wait for the recipient claim\n");
  process.exit(9);
}

const apiIndex = args.indexOf("api");
const operation = apiIndex >= 0 ? args[apiIndex + 1] : undefined;
const walletDb = args.find((arg) => arg.startsWith("--wallet-db=")) ?? "";
const walletConnection = args.find((arg) => arg.startsWith("--wallet-connection=")) ?? "";
const walletTarget = `${walletDb}${walletConnection}`;
const response = (result) => ({ type: "response", operation, id: "fixture", result });

if (operation === "initiatePeerPushDebit" && walletTarget.includes("timeout-wallet")) {
  setTimeout(() => undefined, 5_000);
} else if (operation === "initiatePeerPushDebit" && walletTarget.includes("error-wallet")) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      operation,
      id: "fixture",
      error: { code: 7012, hint: "insufficient balance" },
    }),
  );
} else if (
  operation === "initiatePeerPushDebit" &&
  walletTarget.includes("malformed-init-wallet")
) {
  process.stdout.write(JSON.stringify(response({})));
} else
  switch (operation) {
    case "getVersion":
      process.stdout.write(
        walletTarget.includes("malformed-wallet")
          ? JSON.stringify(response({ implementationSemver: 12 }))
          : JSON.stringify(
              response({
                implementationSemver: walletTarget.includes("unsupported-wallet")
                  ? "1.5.0"
                  : "1.6.12",
                version: "7:0:0",
              }),
            ),
      );
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
      if (walletConnection) {
        process.stderr.write("testing API must not be used with the persistent RPC mode\n");
        process.exitCode = 8;
        break;
      }
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
            txState: walletTarget.includes("expired-wallet")
              ? { major: "expired" }
              : walletTarget.includes("pending-wallet")
                ? { major: "pending", minor: "deposit" }
                : { major: "pending", minor: "ready" },
            ...(walletTarget.includes("expired-wallet") || walletTarget.includes("pending-wallet")
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
