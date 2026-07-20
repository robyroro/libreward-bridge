import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileErrors, validate } from "@readme/openapi-parser";

const result = await validate(resolve("openapi.yaml"));
if (!result.valid) throw new Error(compileErrors(result));

const appSource = await readFile(resolve("src/app.ts"), "utf8");
const openapiSource = await readFile(resolve("openapi.yaml"), "utf8");
const implemented = new Set<string>();
for (const match of appSource.matchAll(/app\.(get|post|patch|delete)\(\s*["']([^"']+)["']/g))
  implemented.add(normalize(match[1] as string, match[2] as string));

const documented = new Set<string>();
let path: string | undefined;
for (const line of openapiSource.split(/\r?\n/)) {
  const pathMatch = /^ {2}(\/[^:]+):\s*$/.exec(line);
  if (pathMatch) {
    path = pathMatch[1];
    continue;
  }
  const methodMatch = /^ {4}(get|post|patch|delete):(?:\s|$)/.exec(line);
  if (path && methodMatch) documented.add(normalize(methodMatch[1] as string, path));
}

const missing = [...implemented].filter((route) => !documented.has(route)).sort();
const stale = [...documented].filter((route) => !implemented.has(route)).sort();
if (missing.length || stale.length)
  throw new Error(
    `OpenAPI route drift detected. Missing: ${missing.join(", ") || "none"}. Stale: ${stale.join(", ") || "none"}.`,
  );
process.stdout.write(
  `OpenAPI document is valid and covers ${implemented.size} implemented routes.\n`,
);

function normalize(method: string, route: string): string {
  return `${method.toUpperCase()} ${route.replace(/:[A-Za-z][A-Za-z0-9_]*/g, "{}").replace(/\{[^}]+\}/g, "{}")}`;
}
