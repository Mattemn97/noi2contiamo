// Sito di presentazione per GitHub Pages: le pagine di `site/` più la demo in memoria in `demo/`.
// Uso: npm run build:site (il risultato è in `_site/`, da pubblicare così com'è).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "_site");
const DEMO = resolve(ROOT, "apps/web/dist-demo");

// Comando fisso, senza argomenti dall'esterno: la shell serve solo a trovare npm anche su Windows.
const build = spawnSync("npm run build:demo -w @noi2contiamo/web", {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(resolve(DEMO, "index.html"))) {
  console.error("Build della demo senza index.html: controlla l'output qui sopra.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(resolve(ROOT, "site"), OUT, { recursive: true });
cpSync(DEMO, resolve(OUT, "demo"), { recursive: true });
// Senza questo file GitHub Pages passa tutto da Jekyll, che scarta le cartelle che iniziano con "_".
writeFileSync(resolve(OUT, ".nojekyll"), "");
console.log(`Sito pronto in ${OUT}`);
