import { createServer } from "node:http";
import { LibreRewardClient, verifyWebhookSignature } from "../../sdk/typescript/client.js";

const baseUrl = required("LIBREREWARD_BASE_URL");
const apiKey = required("LIBREREWARD_TEST_API_KEY");
const webhookSecret = required("LIBREREWARD_WEBHOOK_SECRET");
const client = new LibreRewardClient({ baseUrl, apiKey, timeoutMs: 5_000 });
const reward = await client.createReward(`reference-${Date.now()}`, {
  amount: "KUDOS:1",
  description: "Valueless reference reward",
  external_reference: `opaque-${Date.now()}`,
});
process.stdout.write(`Test claim URL (bearer; do not log in production): ${reward.claim_url}\n`);

const seen = new Set<string>();
createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(request.headers["x-libreward-timestamp"] ?? "");
    const signature = String(request.headers["x-libreward-signature"] ?? "");
    const eventId = String(request.headers["x-libreward-event-id"] ?? "");
    if (
      !eventId ||
      seen.has(eventId) ||
      !verifyWebhookSignature({ secret: webhookSecret, timestamp, signature, rawBody })
    ) {
      response.writeHead(400).end();
      return;
    }
    seen.add(eventId);
    process.stdout.write(`Verified test webhook event ${eventId}\n`);
    response.writeHead(204).end();
  });
}).listen(8090, "127.0.0.1");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
