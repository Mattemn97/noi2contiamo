import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  artifactPolicyArgs,
  firebaseEnv,
  hasDefaultDatabase,
  isBillingPlanError,
  isValidProjectId,
  parseArgs,
  parseCliJson,
  pickWebApp,
  siteUrl,
  suggestProjectId,
} from "./firebase-publish-lib.mjs";

test("ID del progetto: accetta quelli validi e rifiuta gli altri", () => {
  assert.equal(isValidProjectId("noi2contiamo-casa"), true);
  assert.equal(isValidProjectId(suggestProjectId("a1b2c3")), true);
  for (const id of [
    "corto",
    "Maiuscole-no",
    "1inizia-con-cifra",
    "finisce-con-",
    "con_underscore",
    "a".repeat(31),
  ]) {
    assert.equal(isValidProjectId(id), false, id);
  }
});

test("JSON della CLI: ignora gli avvisi prima e dopo", () => {
  assert.deepEqual(parseCliJson('avviso\n{"status":"success","result":[]}\nfine'), {
    status: "success",
    result: [],
  });
  assert.equal(parseCliJson("nessun json"), undefined);
  assert.equal(parseCliJson("{rotto}"), undefined);
});

test("app web: preferisce quella col nome giusto", () => {
  const apps = [
    { appId: "1", displayName: "Altra" },
    { appId: "2", displayName: "Noi2Contiamo" },
  ];
  assert.equal(pickWebApp(apps, "Noi2Contiamo").appId, "2");
  assert.equal(pickWebApp([apps[0]], "Noi2Contiamo").appId, "1");
  assert.equal(pickWebApp([], "Noi2Contiamo"), undefined);
});

test("variabili di build: complete, con authDomain di ripiego, errore se manca qualcosa", () => {
  const env = firebaseEnv({ apiKey: "k", projectId: "p", appId: "a" });
  assert.equal(env.VITE_FIREBASE_AUTH_DOMAIN, "p.firebaseapp.com");
  assert.equal(env.VITE_USE_FIREBASE_EMULATOR, "false");
  assert.throws(() => firebaseEnv({ apiKey: "k" }));
  assert.throws(() => firebaseEnv(undefined));
});

test("database e sito: riconosce il predefinito", () => {
  assert.equal(hasDefaultDatabase([{ name: "projects/p/databases/(default)" }]), true);
  assert.equal(hasDefaultDatabase([{ name: "projects/p/databases/altro" }]), false);
  assert.equal(
    siteUrl(
      [
        { type: "USER_SITE", defaultUrl: "https://x.web.app" },
        { type: "DEFAULT_SITE", defaultUrl: "https://p.web.app" },
      ],
      "p",
    ),
    "https://p.web.app",
  );
  assert.equal(siteUrl([], "p"), "https://p.web.app");
});

test("argomenti: progetto, regione predefinita e aiuto", () => {
  assert.deepEqual(parseArgs(["--project", "casa-mia"]), {
    project: "casa-mia",
    location: "eur3",
    help: false,
  });
  assert.equal(parseArgs(["--location", "europe-west8"]).location, "europe-west8");
  assert.equal(parseArgs(["-h"]).help, true);
});

test("indici Firestore: ogni indice composto ha almeno due campi veri", () => {
  const { indexes } = JSON.parse(readFileSync("firebase/firestore.indexes.json", "utf8"));
  const useless = indexes.filter(
    (index) => index.fields.filter((field) => field.fieldPath !== "__name__").length < 2,
  );
  assert.deepEqual(useless, []);
});

test("funzioni: riconosce l'errore del piano Spark e prepara la pulizia delle immagini", () => {
  assert.equal(
    isBillingPlanError(
      "Error: Your project p must be on the Blaze (pay-as-you-go) plan to complete this command.",
    ),
    true,
  );
  assert.equal(isBillingPlanError("Error: HTTP Error: 403, Cloud Billing API has not been used"), false);
  assert.equal(isBillingPlanError("Error: Failed to compile TypeScript"), false);
  const args = artifactPolicyArgs("casa-mia");
  assert.deepEqual(args.slice(0, 1), ["functions:artifacts:setpolicy"]);
  assert.ok(args.includes("europe-west1") && args.includes("--force") && args.includes("casa-mia"));
});
