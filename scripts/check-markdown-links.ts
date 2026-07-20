import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean);
const failures: string[] = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const raw = (match[1] as string).trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/i.test(raw)) continue;
    const local = decodeURIComponent(raw.split("#", 1)[0] as string);
    if (!local || existsSync(resolve(dirname(file), local))) continue;
    failures.push(`${file}: missing ${raw}`);
  }
}
if (failures.length) throw new Error(`Broken local Markdown links:\n${failures.join("\n")}`);
process.stdout.write(`Checked local links in ${files.length} Markdown files.\n`);
