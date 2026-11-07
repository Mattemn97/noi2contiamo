// Il magazzino su Firestore con l'Admin SDK. Le regole negano `bankingSecrets` a tutti i client:
// solo questa funzione (che salta le regole) legge e scrive chiave privata e collegamenti.
import type { Firestore } from "firebase-admin/firestore";
import type { AuthState, Connection, Secrets, Store } from "./handler.js";

export function createFirestoreStore(db: Firestore): Store {
  const root = (familyId: string) => db.collection("bankingSecrets").doc(familyId);
  const states = (familyId: string) => root(familyId).collection("authStates");
  const connections = (familyId: string) => root(familyId).collection("connections");

  return {
    // Stessa regola di `isMember`/`isOwner` in firebase/firestore.rules: esiste families/{f}/access/{uid}.
    async role(familyId, uid) {
      const snap = await db.doc(`families/${familyId}/access/${uid}`).get();
      if (!snap.exists) return null;
      return snap.get("role") === "owner" ? "owner" : "member";
    },
    async getSecrets(familyId) {
      const snap = await root(familyId).get();
      const appId: unknown = snap.get("appId");
      const privateKeyPem: unknown = snap.get("privateKeyPem");
      return typeof appId === "string" && typeof privateKeyPem === "string" ? { appId, privateKeyPem } : null;
    },
    async setSecrets(familyId, secrets: Secrets) {
      await root(familyId).set(
        { appId: secrets.appId, privateKeyPem: secrets.privateKeyPem },
        { merge: true },
      );
    },
    async putAuthState(familyId, state, value) {
      await states(familyId).doc(state).set(value);
    },
    async takeAuthState(familyId, state) {
      const ref = states(familyId).doc(state);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        return snap.data() as AuthState;
      });
    },
    async purgeAuthStates(familyId, olderThanMs) {
      const old = await states(familyId).where("createdAtMs", "<", olderThanMs).get();
      await Promise.all(old.docs.map((d) => d.ref.delete()));
    },
    async addConnection(familyId, connection) {
      await connections(familyId).doc(connection.id).set(connection);
    },
    async listConnections(familyId, uid) {
      const snap = await connections(familyId).where("uid", "==", uid).get();
      return snap.docs.map((d) => d.data() as Connection).sort((a, b) => a.createdAtMs - b.createdAtMs);
    },
    async getConnection(familyId, id) {
      const snap = await connections(familyId).doc(id).get();
      return snap.exists ? (snap.data() as Connection) : null;
    },
    async deleteConnection(familyId, id) {
      await connections(familyId).doc(id).delete();
    },
  };
}
