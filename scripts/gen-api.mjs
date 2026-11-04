// Rigenera i tipi TypeScript dell'API HTTP dallo schema OpenAPI di FastAPI (spec 0001, Contratto HTTP).
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("node", [
  "scripts/uv.mjs",
  "run",
  "--project",
  "server",
  "python",
  "-m",
  "noi2contiamo_server.openapi",
  "packages/data/openapi.json",
]);
run("npx", [
  "openapi-typescript",
  "packages/data/openapi.json",
  "-o",
  "packages/data/src/api.gen.ts",
  "--default-non-nullable",
  "false",
]);
