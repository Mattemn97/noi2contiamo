// Lancia `uv` se è nel PATH, altrimenti `python -m uv` (uv installato con pip --user).
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opts = { stdio: "inherit", shell: process.platform === "win32" };

const probe = spawnSync("uv", ["--version"], { stdio: "ignore", shell: opts.shell });
const result =
  probe.status === 0
    ? spawnSync("uv", args, opts)
    : spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "uv", ...args], opts);

process.exit(result.status ?? 1);
