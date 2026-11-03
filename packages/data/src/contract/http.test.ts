// Suite di contratto sull'adapter HTTP contro un server FastAPI vero.
// Gira con `npm run test:contract:http` (che avvia il server su un database temporaneo);
// dentro `npm test` resta saltata perché manca N2C_CONTRACT_URL.
import { describe, it, vi } from "vitest";
import type { DataAdapter } from "../index";
import { createHttpAdapter } from "../http";
import { runContractSuite } from "./suite";

const baseUrl = process.env.N2C_CONTRACT_URL;
// Argon2id è lento apposta: ogni test registra e fa accedere più utenti.
vi.setConfig({ testTimeout: 30_000 });

/** `fetch` con il suo barattolo di cookie, come farebbe un browser (sessione e CSRF). */
function cookieFetch(): typeof fetch {
  const jar = new Map<string, string>();
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await fetch(new Request(request, { headers }));
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const [name = "", value = ""] = pair.split("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '""' || value === "") jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    return response;
  };
}

let run = 0;
/** Ogni adapter è un "browser" nuovo; le email diventano uniche per non scontrarsi sullo stesso server. */
function makeAdapter(url: string): DataAdapter {
  const tag = `${Date.now().toString(36)}${(run++).toString(36)}`;
  const adapter = createHttpAdapter({ baseUrl: url, fetch: cookieFetch() });
  const unique = (email: string) => email.replace("@", `+${tag}@`);
  return {
    ...adapter,
    auth: {
      ...adapter.auth,
      signUp: (email, password, displayName) => adapter.auth.signUp(unique(email), password, displayName),
      signIn: (email, password) => adapter.auth.signIn(unique(email), password),
    },
  };
}

if (baseUrl) {
  runContractSuite("http", () => makeAdapter(baseUrl), {
    // Impostazioni e promemoria arrivano con il feature 19, export e import con il feature 23.
    skip: ["personal", "export"],
  });
} else {
  describe.skip("contratto DataAdapter: http (lancia `npm run test:contract:http`)", () => {
    it("serve un server di test", () => undefined);
  });
}
