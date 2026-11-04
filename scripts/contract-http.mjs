// Avvia il server FastAPI su un database temporaneo e lancia la suite di contratto sull'adapter HTTP.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 8765 + Math.floor(Math.random() * 1000);
const dir = mkdtempSync(join(tmpdir(), "n2c-contract-"));
const url = `http://127.0.0.1:${port}`;
const shell = process.platform === "win32";
const env = {
  ...process.env,
  N2C_DATABASE_URL: `sqlite:///${join(dir, "contract.db").replaceAll("\\", "/")}`,
  N2C_STATIC_DIR: join(dir, "nessuna"),
};

const server = spawn(
  "node",
  [
    "scripts/uv.mjs",
    "run",
    "--project",
    "server",
    "uvicorn",
    "noi2contiamo_server.main:app",
    "--port",
    String(port),
  ],
  { env, stdio: ["ignore", "ignore", "pipe"], shell },
);
let log = "";
server.stderr.on("data", (chunk) => (log += chunk));

const stop = () => {
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
  rmSync(dir, { recursive: true, force: true });
};

async function waitForHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // il server sta ancora partendo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Il server di test non è partito:\n${log}`);
}

try {
  await waitForHealth();
  const result = spawnSync("npx", ["vitest", "run", "--project", "data", "src/contract/http.test.ts"], {
    stdio: "inherit",
    shell,
    env: { ...process.env, N2C_CONTRACT_URL: url },
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stop();
}
