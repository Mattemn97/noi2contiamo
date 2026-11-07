// Funzioni pure per scripts/enable-banking-setup.mjs (testate in enable-banking-setup-lib.test.mjs).
import { createSign } from "node:crypto";
import { join } from "node:path";

/** Dove cercare openssl oltre al PATH: su Windows Git for Windows lo installa già. */
export function opensslCandidates(platform, env) {
  if (platform !== "win32") return ["openssl"];
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs"),
  ]
    .filter(Boolean)
    .map((root) => join(root, "Git"));
  return [
    "openssl",
    ...roots.flatMap((git) => [
      join(git, "usr", "bin", "openssl.exe"),
      join(git, "mingw64", "bin", "openssl.exe"),
    ]),
    ...[env.ProgramFiles, env["ProgramFiles(x86)"]]
      .filter(Boolean)
      .map((root) => join(root, "OpenSSL-Win64", "bin", "openssl.exe")),
  ];
}

/** Argomenti di openssl per la chiave RSA 4096 e il certificato autofirmato (10 anni, senza domande). */
export function opensslArgs(keyFile, certFile) {
  return {
    key: ["genrsa", "-out", keyFile, "4096"],
    cert: [
      "req",
      "-new",
      "-x509",
      "-days",
      "3650",
      "-key",
      keyFile,
      "-out",
      certFile,
      "-subj",
      "/CN=Noi2Contiamo",
    ],
  };
}

/** Gli indirizzi di ritorno da registrare su Enable Banking. */
export function redirectUrls(projectId) {
  return [
    ...(projectId
      ? [`https://${projectId}.web.app/importa/banca`, `https://${projectId}.firebaseapp.com/importa/banca`]
      : []),
    "http://localhost:5173/importa/banca",
    "http://localhost:8000/importa/banca",
    "https://localhost/",
  ];
}

/** L'Application ID di Enable Banking è un UUID. */
export function isValidAppId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

const b64url = (value) => Buffer.from(value).toString("base64url");

/** JWT RS256 per l'API di Enable Banking (stessa forma della Cloud Function e del server). */
export function makeJwt(appId, privateKeyPem, nowSeconds) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const body = b64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${body}`)
    .sign(privateKeyPem)
    .toString("base64url");
  return `${header}.${body}.${signature}`;
}

/** Le righe da mettere nel `.env` del server Python. */
export function envLines(appId, keyFile) {
  return [
    `N2C_ENABLE_BANKING_APP_ID=${appId}`,
    `N2C_ENABLE_BANKING_KEY_FILE=${keyFile.replaceAll("\\", "/")}`,
  ];
}

/**
 * Il token di accesso al Control Panel: accetta il token da solo o tutto il comando curl della
 * documentazione di Enable Banking (prende quello dopo "Bearer").
 */
export function parseBearerToken(text) {
  const trimmed = text.trim();
  const token = /Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)/.exec(trimmed)?.[1] ?? trimmed;
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : undefined;
}

/** Email e scadenza (ms) scritte nel token, senza verificarlo: servono solo come proposta e avviso. */
export function tokenInfo(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return {
      email: typeof claims.email === "string" ? claims.email : undefined,
      expiresAtMs: typeof claims.exp === "number" ? claims.exp * 1000 : undefined,
    };
  } catch {
    return {};
  }
}

/** Corpo di POST https://enablebanking.com/api/applications per un'app di produzione. */
export function applicationBody({ name, certificatePem, redirects, email, infoUrl }) {
  return {
    name,
    certificate: certificatePem.replaceAll("\r\n", "\n").trim(),
    environment: "PRODUCTION",
    redirect_urls: redirects,
    description: "Contabilità personale di famiglia, uso non commerciale (Noi2Contiamo)",
    gdpr_email: email,
    privacy_url: infoUrl,
    terms_url: infoUrl,
  };
}

/** Il comando curl equivalente alla richiesta, con il token nascosto: lo script lo mostra prima di eseguirlo. */
export function curlCommand(url, body) {
  const shown = "certificate" in body ? { ...body, certificate: "<contenuto di public.crt>" } : body;
  const json = JSON.stringify(shown, null, 2).replaceAll("'", `'"'"'`);
  return [
    `curl -X POST "${url}"`,
    `  -H "Authorization: Bearer <il tuo token>"`,
    `  -H "Content-Type: application/json"`,
    `  -d '${json}'`,
  ].join(" \\\n");
}

/** L'Application ID dalla risposta di POST /api/applications (`{"app_id": "..."}`). */
export function appIdFrom(text) {
  try {
    const id = JSON.parse(text).app_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}
