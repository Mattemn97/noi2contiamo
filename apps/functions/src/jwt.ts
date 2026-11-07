// JWT RS256 per Enable Banking, firmato con node:crypto (nessuna libreria in più: la build cloud è leggera).
import { createSign } from "node:crypto";

export const JWT_TTL_SECONDS = 3600;

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** `kid` = id dell'app; `nowSeconds` iniettabile per i test. Lancia se la chiave non è una chiave RSA valida. */
export function makeJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const body = b64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: nowSeconds,
      exp: nowSeconds + JWT_TTL_SECONDS,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKeyPem);
  return `${header}.${body}.${b64url(signature)}`;
}
