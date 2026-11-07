import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
  appIdFrom,
  applicationBody,
  curlCommand,
  envLines,
  isValidAppId,
  makeJwt,
  opensslArgs,
  opensslCandidates,
  parseBearerToken,
  redirectUrls,
  tokenInfo,
} from "./enable-banking-setup-lib.mjs";

test("openssl: su Windows cerca anche dentro Git for Windows", () => {
  assert.deepEqual(opensslCandidates("linux", {}), ["openssl"]);
  const win = opensslCandidates("win32", { ProgramFiles: "C:\\Program Files" });
  assert.equal(win[0], "openssl");
  assert.ok(win.some((p) => p.includes("Git") && p.endsWith("openssl.exe")));
});

test("openssl: certificato senza domande interattive", () => {
  const { key, cert } = opensslArgs("k.key", "c.crt");
  assert.deepEqual(key, ["genrsa", "-out", "k.key", "4096"]);
  assert.ok(cert.includes("-subj") && cert.includes("-x509"));
});

test("indirizzi di ritorno: con il progetto Firebase e senza", () => {
  assert.ok(redirectUrls("casa-mia").includes("https://casa-mia.web.app/importa/banca"));
  assert.deepEqual(redirectUrls(undefined), [
    "http://localhost:5173/importa/banca",
    "http://localhost:8000/importa/banca",
    "https://localhost/",
  ]);
});

test("Application ID: solo UUID", () => {
  assert.equal(isValidAppId(" 0f8fad5b-d9cb-469f-a165-70867728950e "), true);
  assert.equal(isValidAppId("non-un-id"), false);
});

test("JWT: firma RS256 verificabile con il kid dell'app", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const [h, b, s] = makeJwt("app-1", pem, 1000).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), {
    typ: "JWT",
    alg: "RS256",
    kid: "app-1",
  });
  assert.equal(JSON.parse(Buffer.from(b, "base64url").toString()).exp, 4600);
  assert.equal(
    createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s, "base64url")),
    true,
  );
});

test("righe del .env con le barre in avanti", () => {
  assert.deepEqual(envLines("id", "C:\\k\\private.key"), [
    "N2C_ENABLE_BANKING_APP_ID=id",
    "N2C_ENABLE_BANKING_KEY_FILE=C:/k/private.key",
  ]);
});

const fakeToken = (claims) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.firma_x-1`;

test("token: dal comando curl o da solo, rifiuta il resto", () => {
  const token = fakeToken({ email: "a@b.it" });
  assert.equal(parseBearerToken(`curl -X POST -H "Authorization: Bearer ${token}" -d "{}" https://x`), token);
  assert.equal(parseBearerToken(`  ${token}\n`), token);
  assert.equal(parseBearerToken("non è un token"), undefined);
});

test("token: email e scadenza come proposta", () => {
  assert.deepEqual(tokenInfo(fakeToken({ email: "a@b.it", exp: 10 })), {
    email: "a@b.it",
    expiresAtMs: 10_000,
  });
  assert.deepEqual(tokenInfo("x.y.z"), {});
});

test("app di produzione con i campi obbligatori e il certificato senza CR", () => {
  const body = applicationBody({
    name: "Noi2Contiamo",
    certificatePem: "-----BEGIN CERTIFICATE-----\r\nAAA\r\n-----END CERTIFICATE-----\r\n",
    redirects: ["https://localhost/"],
    email: "a@b.it",
    infoUrl: "https://example.org",
  });
  assert.equal(body.environment, "PRODUCTION");
  assert.equal(body.certificate, "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----");
  for (const field of ["description", "gdpr_email", "privacy_url", "terms_url"])
    assert.ok(body[field], field);
});

test("comando curl mostrato senza token né certificato, su più righe", () => {
  const command = curlCommand("https://enablebanking.com/api/applications", {
    name: "L'app",
    certificate: "-----BEGIN CERTIFICATE-----",
  });
  assert.ok(command.includes("<il tuo token>"));
  assert.ok(command.includes("<contenuto di public.crt>") && !command.includes("BEGIN CERTIFICATE"));
  assert.ok(command.includes(`"L'"'"'app"`));
  assert.ok(command.includes(" \\\n  -H"));
});

test("Application ID dalla risposta", () => {
  assert.equal(appIdFrom('{"app_id":"abc"}'), "abc");
  assert.equal(appIdFrom("errore"), undefined);
  assert.equal(appIdFrom("{}"), undefined);
});
