import { resolve } from "node:path";
import { compileErrors, validate } from "@readme/openapi-parser";

const result = await validate(resolve("openapi.yaml"));
if (!result.valid) throw new Error(compileErrors(result));
process.stdout.write("OpenAPI document is valid.\n");
