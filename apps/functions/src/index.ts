// Cloud Function `bank` (open banking, feature 24): firma il JWT di Enable Banking e inoltra le richieste,
// perché il browser non può chiamare quell'API (niente CORS). Richiede il piano Blaze; usa solo la quota gratuita
// (una sola istanza, 256 MiB, nessuna istanza sempre accesa).
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { createFirestoreStore } from "./firestoreStore.js";
import { handleBank } from "./handler.js";

if (getApps().length === 0) initializeApp();

const project = process.env.GCLOUD_PROJECT ?? "";
const ORIGINS = [
  `https://${project}.web.app`,
  `https://${project}.firebaseapp.com`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const BEARER = /^Bearer (.+)$/i;

export const bank = onRequest(
  { region: "europe-west1", maxInstances: 1, minInstances: 0, memory: "256MiB", cors: ORIGINS },
  async (request, response) => {
    const store = createFirestoreStore(getFirestore());
    const verifyToken = async (idToken: string) => {
      try {
        return (await getAuth().verifyIdToken(idToken)).uid;
      } catch {
        return null;
      }
    };
    const query = Object.fromEntries(
      Object.entries(request.query).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
    try {
      const result = await handleBank(
        { verifyToken, store },
        {
          method: request.method,
          path: request.path,
          query,
          body: request.body as unknown,
          idToken: BEARER.exec(request.header("authorization") ?? "")?.[1] ?? null,
        },
      );
      if (result.body === undefined) response.status(result.status).end();
      else response.status(result.status).json(result.body);
    } catch (error) {
      console.error("bank: errore inatteso", error instanceof Error ? error.message : "sconosciuto");
      response.status(500).json({ code: "bank_error", message: "Errore del servizio bancario." });
    }
  },
);
