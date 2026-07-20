import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
const forbiddenNames = /(?:^|\/)(?:\.env|id_[^/]+|wallet[^/]*\.(?:db|sqlite3?))$/i;
const forbiddenExtensions = new Set([".key", ".p12", ".pfx", ".jks", ".keystore"]);
const badNames = files.filter(
  (file) =>
    (forbiddenNames.test(file) && file !== ".env.example") ||
    forbiddenExtensions.has(extname(file).toLowerCase()),
);
const privateKeys = files.filter((file) => {
  if (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".pdf")) return false;
  try {
    return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
});
const failures = [...new Set([...badNames, ...privateKeys])];
if (failures.length)
  throw new Error(`Forbidden sensitive artifacts are tracked:\n${failures.join("\n")}`);
process.stdout.write(`Checked ${files.length} tracked paths for forbidden sensitive artifacts.\n`);
