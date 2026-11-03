// Suite di contratto sull'adapter Firebase contro l'emulatore (Auth + Firestore con le regole vere).
// NON VERIFICATA: l'emulatore richiede Java 21. Per lanciarla:
//   npx firebase-tools@15.34 emulators:exec --only auth,firestore "npx vitest run --project data src/contract/firebase.test.ts"
// (emulators:exec imposta FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST).
import { describe, it } from "vitest";
import { createFirebaseAdapter } from "../firebase";
import { runContractSuite } from "./suite";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (firestoreHost && authHost) {
  const [host = "127.0.0.1", port = "8080"] = firestoreHost.split(":");
  let run = 0;
  runContractSuite(
    "firebase (emulatore)",
    () =>
      createFirebaseAdapter({
        app: { apiKey: "demo-key", projectId: "demo-noi2contiamo", appId: "demo" },
        name: `contract-${Date.now()}-${run++}`,
        emulator: { authUrl: `http://${authHost}`, firestoreHost: host, firestorePort: Number(port) },
      }),
    // Il filo base è pronto; inviti (feature 6), impostazioni (19) ed export (23) non ancora in Firebase,
    // e il resto della suite usa gli inviti per creare il partner.
    {
      skip: ["documents", "queries", "commit", "isolation", "personal", "fingerprint", "membership", "invites", "catalog", "export"],
    },
  );
} else {
  describe.skip(
    "contratto DataAdapter: firebase (saltato: serve l'emulatore Firestore con Java 21, vedi l'intestazione del file)",
    () => {
      it("emulatore non attivo", () => undefined);
    },
  );
}
