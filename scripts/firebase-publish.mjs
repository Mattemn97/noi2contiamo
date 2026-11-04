// Pubblica Noi2Contiamo su un progetto Firebase personale (piano Spark gratuito).
// Uso: npm run firebase:publish [-- --project <id>] [-- --location eur3]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  firebaseEnv,
  hasDefaultDatabase,
  isValidProjectId,
  parseArgs,
  parseCliJson,
  pickWebApp,
  siteUrl,
  suggestProjectId,
} from "./firebase-publish-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIREBASERC = resolve(ROOT, ".firebaserc");
const CLI = ["--yes", "firebase-tools@15.34"];
const APP_NAME = "Noi2Contiamo";
const WINDOWS = process.platform === "win32";
const CONSOLE = "https://console.firebase.google.com";

/**
 * Se il file di configurazione di firebase-tools esiste ma è illeggibile (permessi di Windows rovinati),
 * la CLI si blocca all'avvio: in quel caso usa una cartella tutta sua, fuori dal repository.
 * Il file originale non viene letto né modificato.
 */
function useOwnConfigIfBlocked() {
  if (process.env.XDG_CONFIG_HOME) return;
  const stored = join(homedir(), ".config", "configstore", "firebase-tools.json");
  try {
    closeSync(openSync(stored, "r"));
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") return;
    const own = join(process.env.LOCALAPPDATA ?? homedir(), "noi2contiamo", "firebase-tools");
    mkdirSync(own, { recursive: true });
    process.env.XDG_CONFIG_HOME = own;
    console.log(`Il file ${stored} non è leggibile: uso ${own}. Ti verrà chiesto di accedere a Google.`);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

const step = (text) => {
  console.log(`\n=== ${text}`);
};

function fail(message) {
  console.error(`\nErrore: ${message}`);
  rl.close();
  process.exit(1);
}

/** Comando visibile e interattivo: l'utente vede l'output e può rispondere. */
function runVisible(command, args, env = process.env) {
  return spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: WINDOWS, env }).status === 0;
}

const firebase = (...args) => runVisible("npx", [...CLI, ...args]);

/** Comando silenzioso che risponde in JSON. Restituisce `result`, o undefined se è fallito. */
function firebaseJson(...args) {
  const run = spawnSync("npx", [...CLI, ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: WINDOWS,
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = parseCliJson(run.stdout ?? "");
  return parsed?.status === "success" ? parsed.result : undefined;
}

async function waitForManualStep(instructions) {
  console.log(`\nServe un passaggio a mano:\n${instructions}`);
  await rl.question("\nQuando hai finito premi Invio per continuare... ");
}

function savedProject() {
  if (!existsSync(FIREBASERC)) return undefined;
  try {
    const id = JSON.parse(readFileSync(FIREBASERC, "utf8")).projects?.default;
    return isValidProjectId(id ?? "") ? id : undefined;
  } catch {
    return undefined;
  }
}

async function askProjectId(question, fallback) {
  for (;;) {
    const answer = (await rl.question(question)).trim() || fallback;
    if (answer && isValidProjectId(answer)) return answer;
    console.log("ID non valido: 6-30 caratteri, minuscole, cifre e trattini, inizia con una lettera.");
  }
}

async function ensureLogin() {
  step("Accesso a Google");
  const accounts = firebaseJson("login:list");
  if (Array.isArray(accounts) && accounts.length > 0) {
    console.log(`Accesso già fatto: ${accounts[0].user?.email ?? "account Google"}.`);
    return;
  }
  if (!firebase("login")) fail("accesso a Google non riuscito.");
}

async function createProject() {
  const suggestion = suggestProjectId(randomBytes(3).toString("hex"));
  console.log("\nL'ID è unico in tutto Google e non si può cambiare: farà parte dell'indirizzo del sito.");
  const id = await askProjectId(`ID del nuovo progetto [${suggestion}]: `, suggestion);
  if (firebase("projects:create", id, "--display-name", APP_NAME)) return id;
  await waitForManualStep(
    `La creazione automatica non è riuscita: l'ID può essere già preso, oppure devi accettare i termini di Firebase.
1. Apri ${CONSOLE} e crea un progetto (Google Analytics può restare spento).
2. Resta sul piano Spark: non inserire dati di pagamento.`,
  );
  return askProjectId("ID del progetto che hai creato: ");
}

async function chooseProject(fromArgs) {
  step("Progetto Firebase");
  if (fromArgs) {
    if (!isValidProjectId(fromArgs)) fail(`"${fromArgs}" non è un ID di progetto valido.`);
    return fromArgs;
  }
  const saved = savedProject();
  if (saved) {
    const reuse = (await rl.question(`Uso il progetto "${saved}" dell'ultima volta? [S/n] `))
      .trim()
      .toLowerCase();
    if (reuse !== "n") return saved;
  }
  const projects = firebaseJson("projects:list");
  if (Array.isArray(projects) && projects.length > 0) {
    console.log("I tuoi progetti:");
    for (const project of projects) console.log(`  - ${project.projectId}`);
  }
  const choice = (
    await rl.question("\n1) Ho già un progetto, indico l'ID\n2) Creane uno nuovo\nScelta [1/2]: ")
  ).trim();
  return choice === "2" ? createProject() : askProjectId("ID del progetto: ");
}

async function ensureWebConfig(project) {
  step("App web");
  const apps = firebaseJson("apps:list", "WEB", "--project", project);
  if (apps === undefined)
    fail(`non riesco a leggere il progetto "${project}". Controlla l'ID e l'account Google.`);
  const existing = pickWebApp(apps, APP_NAME);
  const app = existing ?? firebaseJson("apps:create", "WEB", APP_NAME, "--project", project);
  if (!app?.appId) fail("creazione dell'app web non riuscita.");
  console.log(existing ? `Uso l'app web esistente "${existing.displayName}".` : "App web creata.");
  const sdk = firebaseJson("apps:sdkconfig", "WEB", app.appId, "--project", project);
  return firebaseEnv(sdk?.sdkConfig ?? sdk);
}

async function ensureDatabase(project, location) {
  step("Database Firestore");
  const databases = firebaseJson("firestore:databases:list", "--project", project);
  if (Array.isArray(databases) && hasDefaultDatabase(databases)) {
    console.log("Database già presente.");
    return;
  }
  const name = WINDOWS ? '"(default)"' : "(default)";
  if (firebase("firestore:databases:create", name, "--location", location, "--project", project)) return;
  await waitForManualStep(
    `Apri ${CONSOLE}/project/${project}/firestore e premi "Crea database".
Scegli una regione europea e la modalità di produzione: le regole le carico io subito dopo.`,
  );
}

async function ensureEmailLogin(project) {
  step("Accesso con email e password");
  if (firebase("deploy", "--only", "auth", "--project", project)) return;
  await waitForManualStep(
    `Apri ${CONSOLE}/project/${project}/authentication/providers,
premi "Inizia" se richiesto e abilita il provider Email/password.`,
  );
}

function ensureSite(project) {
  step("Sito");
  const listed = firebaseJson("hosting:sites:list", "--project", project);
  const sites = listed?.sites ?? [];
  if (sites.length > 0) return sites;
  if (!firebase("hosting:sites:create", project, "--project", project)) {
    console.log("Non ho potuto creare il sito: provo comunque a pubblicare su quello predefinito.");
  }
  return firebaseJson("hosting:sites:list", "--project", project)?.sites ?? [];
}

function printHelp() {
  console.log(`Pubblica Noi2Contiamo su un tuo progetto Firebase (piano Spark gratuito).

  npm run firebase:publish                        guidato
  npm run firebase:publish -- --project <id>      usa un progetto esistente
  npm run firebase:publish -- --location <regione>  regione del database (predefinita: eur3)

Rilancialo quando vuoi per pubblicare una versione nuova: i dati restano.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    rl.close();
    return;
  }

  useOwnConfigIfBlocked();
  await ensureLogin();
  const project = await chooseProject(args.project);
  writeFileSync(FIREBASERC, `${JSON.stringify({ projects: { default: project } }, null, 2)}\n`);

  const env = await ensureWebConfig(project);
  await ensureDatabase(project, args.location);
  await ensureEmailLogin(project);
  const sites = ensureSite(project);

  step("Compilazione");
  if (!existsSync(resolve(ROOT, "node_modules")) && !runVisible("npm", ["install"])) {
    fail("npm install non riuscito.");
  }
  if (!runVisible("npm", ["run", "build:firebase"], { ...process.env, ...env }))
    fail("compilazione non riuscita.");

  step("Pubblicazione di sito, regole e indici");
  if (!firebase("deploy", "--only", "hosting,firestore", "--project", project))
    fail("pubblicazione non riuscita.");

  console.log(`\nFatto. Il sito è online: ${siteUrl(sites, project)}`);
  console.log("Gli indici di Firestore possono impiegare qualche minuto a essere pronti.");
  rl.close();
}

await main();
