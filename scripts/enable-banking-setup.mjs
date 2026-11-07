// Prepara l'app Enable Banking per l'import dal conto: crea chiave e certificato con openssl
// e guida passo passo nel Control Panel. Uso: npm run bank:setup [-- --out <cartella>]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  envLines,
  appIdFrom,
  applicationBody,
  curlCommand,
  isValidAppId,
  makeJwt,
  opensslArgs,
  opensslCandidates,
  parseBearerToken,
  redirectUrls,
  tokenInfo,
} from "./enable-banking-setup-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const WINDOWS = process.platform === "win32";
const SIGN_IN = "https://enablebanking.com/sign-in/";
const CONTROL_PANEL = "https://enablebanking.com/cp/applications";
const API = "https://api.enablebanking.com";
const APPLICATIONS_API = "https://enablebanking.com/api/applications";
const DOCS = "https://enablebanking.com/docs/api/reference/";

const rl = createInterface({ input: process.stdin, output: process.stdout });

const step = (n, text) => console.log(`\n=== Passo ${n}. ${text}`);

function fail(message) {
  console.error(`\nErrore: ${message}`);
  rl.close();
  process.exit(1);
}

async function yes(question, fallback = true) {
  const answer = (await rl.question(`${question} ${fallback ? "[S/n]" : "[s/N]"} `)).trim().toLowerCase();
  return answer === "" ? fallback : answer.startsWith("s") || answer.startsWith("y");
}

const pause = () => rl.question("\nQuando hai fatto premi Invio per continuare... ");

function openInBrowser(url) {
  const [command, args] = WINDOWS
    ? ["cmd", ["/c", "start", "", url]]
    : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawnSync(command, args, { stdio: "ignore" });
}

async function offerOpen(url) {
  console.log(`Indirizzo: ${url}`);
  if (await yes("Lo apro nel browser?")) openInBrowser(url);
}

function outDir() {
  const i = process.argv.indexOf("--out");
  return resolve(
    i > 0 && process.argv[i + 1] ? process.argv[i + 1] : join(homedir(), ".noi2contiamo", "enable-banking"),
  );
}

// MSYS (openssl di Git for Windows) non deve trasformare "/CN=..." in un percorso.
const OPENSSL_ENV = { ...process.env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" };

function findOpenssl() {
  for (const candidate of opensslCandidates(process.platform, process.env)) {
    const run = spawnSync(candidate, ["version"], { encoding: "utf8", env: OPENSSL_ENV });
    if (run.status === 0) return { path: candidate, version: run.stdout.trim() };
  }
  return undefined;
}

function firebaseProject() {
  try {
    return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8")).projects?.default;
  } catch {
    return undefined;
  }
}

function repoUrl() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).homepage;
  } catch {
    return undefined;
  }
}

async function checkKey(appId, pem) {
  try {
    const response = await fetch(`${API}/aspsps?country=IT&psu_type=personal`, {
      headers: { Authorization: `Bearer ${makeJwt(appId, pem, Math.floor(Date.now() / 1000))}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const banks = (await response.json()).aspsps ?? [];
      return { ok: true, message: `chiave accettata, ${banks.length} banche italiane disponibili.` };
    }
    return {
      ok: false,
      message: `Enable Banking risponde ${response.status}: ${(await response.text()).slice(0, 200)}`,
    };
  } catch (error) {
    return { ok: false, message: `chiamata non riuscita (${error.message}).` };
  }
}

async function registerManually({ certFile, project, repo }) {
  console.log("\nRegistrazione a mano nel Control Panel.");
  console.log(`Vai in Applications e premi "Add a new application". Compila così:
  - Environment: PRODUCTION   (non Sandbox: la sandbox ha solo dati finti)
  - Application name: Noi2Contiamo
  - Certificate: carica il file ${certFile}
  - Redirect URLs (una per riga):
${redirectUrls(project)
  .map((url) => `      ${url}`)
  .join("\n")}
  - Description: Contabilità personale di famiglia, uso non commerciale
  - GDPR email: la tua email
  - Privacy URL e Terms URL: ${repo ?? "l'indirizzo del tuo sito o del repository"}
Poi premi "Register".`);
  if (!project)
    console.log(
      "(Nessun progetto Firebase in .firebaserc: se pubblichi su Firebase aggiungi anche https://<progetto>.web.app/importa/banca)",
    );
  await offerOpen(CONTROL_PANEL);
  await pause();

  console.log(
    "Nella lista delle applicazioni copia l'ID della nuova app (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).",
  );
  let appId;
  for (;;) {
    appId = (await rl.question("Application ID: ")).trim();
    if (isValidAppId(appId)) break;
    console.log("Non sembra un Application ID valido, riprova.");
  }
  return appId;
}

/** Chiede un valore nel terminale, con una proposta che basta confermare con Invio. */
async function ask(question, proposal) {
  for (;;) {
    const answer = (await rl.question(proposal ? `${question} [${proposal}]: ` : `${question}: `)).trim();
    if (answer || proposal) return answer || proposal;
    console.log("Serve un valore.");
  }
}

/**
 * Registra l'app partendo dal comando curl della documentazione di Enable Banking: ne prende token e
 * indirizzo, lo riscrive con i dati del progetto (produzione, certificato, indirizzi di ritorno, email)
 * e lo esegue dopo la conferma. Il token non viene salvato né mostrato.
 */
async function registerAutomatically({ certFile, project, repo }) {
  console.log(`Posso registrare l'app per te con il comando della documentazione di Enable Banking.
1. Con l'accesso fatto, apri la documentazione dell'API e cerca la registrazione dell'applicazione
   (l'esempio "curl -X POST ... https://enablebanking.com/api/applications").
2. Copia tutto il comando: contiene già il tuo token personale dopo "Bearer".
3. Incollalo qui: lo riscrivo con i tuoi dati e quelli del progetto e lo eseguo.
Il token è personale, scade dopo circa un'ora e qui non viene salvato.`);
  if (!(await yes("Registro l'app in automatico?"))) return undefined;
  await offerOpen(DOCS);
  for (;;) {
    const pasted = await rl.question("\nIncolla il comando curl (o solo il token): ");
    const token = parseBearerToken(pasted);
    if (!token) {
      console.log('Nel testo non trovo un token dopo "Bearer".');
      if (await yes("Riprovo?")) continue;
      return undefined;
    }
    const info = tokenInfo(token);
    if (info.expiresAtMs !== undefined && info.expiresAtMs < Date.now()) {
      console.log("Il token è scaduto: ricarica la pagina della documentazione e copia di nuovo il comando.");
      continue;
    }

    console.log("\nControlla i dati dell'app (Invio per confermare la proposta):");
    const name = await ask("Nome dell'applicazione", "Noi2Contiamo");
    const email = await ask("Email per le richieste GDPR", info.email);
    const infoUrl = await ask("Pagina di privacy e termini d'uso", repo);
    const firebaseId =
      project ??
      ((await rl.question("ID del progetto Firebase (vuoto se non lo usi): ")).trim() || undefined);
    const body = applicationBody({
      name,
      certificatePem: readFileSync(certFile, "utf8"),
      redirects: redirectUrls(firebaseId),
      email,
      infoUrl,
    });

    console.log(`\nEseguo questo comando (token nascosto):\n\n${curlCommand(APPLICATIONS_API, body)}\n`);
    if (!(await yes("Procedo?"))) return undefined;
    try {
      const response = await fetch(APPLICATIONS_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      const appId = response.ok ? appIdFrom(text) : undefined;
      if (appId) {
        console.log(`App registrata in produzione. Application ID: ${appId}`);
        return appId;
      }
      console.log(`Enable Banking ha risposto ${response.status}: ${text.slice(0, 300)}`);
    } catch (error) {
      console.log(`Chiamata non riuscita (${error.message}).`);
    }
    if (!(await yes("Riprovo con un nuovo comando?", false))) return undefined;
  }
}

async function main() {
  console.log("Configurazione di Enable Banking per l'import automatico dal conto bancario.");
  console.log("Servizio gratuito per uso personale: leggerai solo i conti che colleghi tu.");

  const dir = outDir();
  const keyFile = join(dir, "private.key");
  const certFile = join(dir, "public.crt");
  const configFile = join(dir, "app.json");

  step(1, "Controllo di openssl");
  const openssl = findOpenssl();
  if (!openssl) {
    fail(
      WINDOWS
        ? "openssl non trovato. Installa Git for Windows (https://git-scm.com, lo include) oppure\n" +
            "  winget install ShiningLight.OpenSSL.Light\npoi riapri il terminale e rilancia npm run bank:setup."
        : "openssl non trovato. Installalo (macOS: brew install openssl, Debian/Ubuntu: sudo apt install openssl) e rilancia.",
    );
  }
  console.log(`Trovato: ${openssl.version} (${openssl.path})`);

  step(2, "Chiave privata e certificato pubblico");
  mkdirSync(dir, { recursive: true });
  const reuse =
    existsSync(keyFile) && existsSync(certFile) && (await yes(`Esistono già in ${dir}. Li riuso?`));
  if (!reuse) {
    if (
      existsSync(keyFile) &&
      !(await yes("Sovrascrivo la chiave esistente? Quella vecchia smetterà di funzionare.", false))
    )
      fail("nessuna chiave sovrascritta.");
    const args = opensslArgs(keyFile, certFile);
    const run = (a) => spawnSync(openssl.path, a, { stdio: "inherit", env: OPENSSL_ENV }).status === 0;
    if (!run(args.key) || !run(args.cert))
      fail("openssl non è riuscito a creare la chiave o il certificato.");
    console.log("Creati.");
  }
  console.log(`  chiave privata:     ${keyFile}   (NON caricarla né condividerla)`);
  console.log(`  certificato:        ${certFile}   (questo lo carichi su Enable Banking)`);

  step(3, "Account Enable Banking");
  console.log("Entra con la tua email: ricevi un link di accesso, niente password.");
  await offerOpen(SIGN_IN);
  await pause();

  step(4, "Registrazione dell'applicazione");
  const project = firebaseProject();
  const repo = repoUrl();
  const appId =
    (await registerAutomatically({ certFile, project, repo })) ??
    (await registerManually({ certFile, project, repo }));
  writeFileSync(configFile, `${JSON.stringify({ appId, keyFile, certFile }, null, 2)}\n`);

  step(5, "Attivazione collegando i tuoi conti");
  console.log(`Nella pagina dell'app premi "Activate by linking accounts", scegli la tua banca,
autorizza l'accesso sul sito della banca e ripeti per ogni conto che vuoi importare.
Finché non lo fai l'app resta inattiva e non legge nessun movimento.`);
  await pause();

  step(6, "Prova della chiave");
  const check = await checkKey(appId, readFileSync(keyFile, "utf8"));
  console.log(check.ok ? `OK: ${check.message}` : `Attenzione: ${check.message}`);
  if (!check.ok)
    console.log(
      "Controlla Application ID, certificato caricato e attivazione; puoi rilanciare lo script e riusare la chiave.",
    );

  console.log(`\n=== Fatto. Dati salvati in ${configFile}
Ora scegli come importare:

- Firebase piano Spark (gratuito), scarica un CSV e importalo da "Importa > Da file CSV":
    npm run bank:csv -- --app-id ${appId} --key-file "${keyFile}"

- Firebase piano Blaze, apri il sito > Importa > Dal conto bancario e inserisci
  Application ID (${appId}) e il contenuto di ${keyFile} (solo il proprietario della famiglia).

- Server Python, aggiungi al .env e riavvia:
${envLines(appId, keyFile)
  .map((line) => `    ${line}`)
  .join("\n")}

Guida completa: docs/guida-open-banking.md`);
  rl.close();
}

await main();
