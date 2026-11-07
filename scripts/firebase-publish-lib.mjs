// Funzioni pure di firebase-publish.mjs: controllano gli input e leggono le risposte della CLI.

/** Regole di Google per l'ID di un progetto: 6-30 caratteri, minuscole, cifre e trattini. */
export function isValidProjectId(id) {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id);
}

/** Propone un ID libero con buona probabilità: gli ID sono unici in tutto Google Cloud. */
export function suggestProjectId(suffix) {
  return `noi2contiamo-${suffix}`;
}

/** La CLI può scrivere avvisi prima del JSON: prende solo l'oggetto. Restituisce undefined se non c'è. */
export function parseCliJson(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Riusa l'app web chiamata Noi2Contiamo, altrimenti la prima: mai crearne una in più a ogni deploy. */
export function pickWebApp(apps, displayName) {
  return apps.find((app) => app.displayName === displayName) ?? apps[0];
}

/** Variabili che Vite inserisce nella build. Lancia un errore se la configurazione è incompleta. */
export function firebaseEnv(sdkConfig) {
  const { apiKey, authDomain, projectId, appId } = sdkConfig ?? {};
  if (!apiKey || !projectId || !appId) {
    throw new Error("Configurazione dell'app web incompleta.");
  }
  return {
    VITE_FIREBASE_API_KEY: apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: authDomain ?? `${projectId}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_APP_ID: appId,
    VITE_USE_FIREBASE_EMULATOR: "false",
  };
}

export function hasDefaultDatabase(databases) {
  return databases.some((database) => String(database.name ?? database).endsWith("/databases/(default)"));
}

/** Indirizzo del sito: quello del sito predefinito, altrimenti l'indirizzo standard del progetto. */
export function siteUrl(sites, projectId) {
  const site = sites.find((entry) => entry.type === "DEFAULT_SITE") ?? sites[0];
  return site?.defaultUrl ?? `https://${projectId}.web.app`;
}

export function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    project: value("--project"),
    location: value("--location") ?? "eur3",
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/** Regione della Cloud Function `bank` (open banking, feature 24): deve coincidere con apps/functions. */
export const FUNCTIONS_REGION = "europe-west1";

/** La CLI rifiuta di pubblicare le funzioni sul piano Spark: serve il piano Blaze (con fatturazione). */
export function isBillingPlanError(output) {
  return /\bblaze\b|pay[- ]as[- ]you[- ]go|billing account|requires billing|upgrade your project|must be on (a|the) .*plan/i.test(
    output,
  );
}

/** Argomenti per tenere le immagini della funzione in Artifact Registry dentro lo spazio gratuito. */
export function artifactPolicyArgs(project) {
  return [
    "functions:artifacts:setpolicy",
    "--location",
    FUNCTIONS_REGION,
    "--days",
    "1",
    "--force",
    "--project",
    project,
  ];
}
