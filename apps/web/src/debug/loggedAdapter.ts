// Il DataAdapter con il registro di diagnostica: ogni chiamata scrive metodo, collezione, conteggi,
// durata ed esito. Mai i documenti, le email o i token: solo forma e codici.
import type { Result } from "@noi2contiamo/core";
import type { CommitOp, DataAdapter } from "@noi2contiamo/data";
import { logError, logInfo, logWarn } from "./log";

type AnyFn = (...args: never[]) => Promise<unknown>;

const outcomeOf = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && "ok" in value) {
    const result = value as Result<unknown, unknown>;
    if (result.ok) {
      const page = result.value as { docs?: unknown[] } | undefined;
      return Array.isArray(page?.docs) ? { ok: true, count: page.docs.length } : { ok: true };
    }
    return { ok: false, error: result.error };
  }
  return {};
};

/** Riassunto di un commit: quante operazioni per collezione, senza contenuti. */
export function summarizeOps(ops: readonly CommitOp[]): Record<string, unknown> {
  const collections: Record<string, number> = {};
  for (const op of ops) {
    const key = `${op.type} ${op.collection}`;
    collections[key] = (collections[key] ?? 0) + 1;
  }
  return { ops: ops.length, collections: Object.entries(collections).map(([k, n]) => `${k}: ${n}`) };
}

function wrap<F extends AnyFn>(
  event: string,
  fn: F,
  describe: (...args: Parameters<F>) => Record<string, unknown>,
): F {
  return (async (...args: Parameters<F>) => {
    const details = describe(...args);
    const start = performance.now();
    try {
      const value = await fn(...args);
      const outcome = outcomeOf(value);
      const duration = Math.round(performance.now() - start);
      if (outcome.ok === false) logWarn(event, { ...details, ...outcome, duration });
      else logInfo(event, { ...details, ...outcome, duration });
      return value;
    } catch (error) {
      logError(event, error, { ...details, duration: Math.round(performance.now() - start) });
      throw error;
    }
  }) as F;
}

const none = () => ({});

/** Tutti i metodi di `membership`; il primo argomento è la famiglia, tranne in `acceptInvite` (token segreto). */
function wrapMembership(membership: DataAdapter["membership"]): DataAdapter["membership"] {
  return Object.fromEntries(
    Object.entries(membership).map(([name, fn]) => [
      name,
      typeof fn === "function"
        ? wrap(`membership.${name}`, (fn as AnyFn).bind(membership), (...args: unknown[]) =>
            name !== "acceptInvite" && typeof args[0] === "string" ? { familyId: args[0] } : {},
          )
        : fn,
    ]),
  ) as unknown as DataAdapter["membership"];
}

export function withLogging(adapter: DataAdapter): DataAdapter {
  const { auth, membership } = adapter;
  return {
    kind: adapter.kind,
    auth: {
      // Le credenziali non entrano mai nei dettagli: solo l'esito.
      signUp: wrap("auth.signUp", auth.signUp.bind(auth), none),
      signIn: wrap("auth.signIn", auth.signIn.bind(auth), none),
      signOut: wrap("auth.signOut", auth.signOut.bind(auth), none),
      currentUser: auth.currentUser.bind(auth),
      onChange: auth.onChange.bind(auth),
    },
    membership: wrapMembership(membership),
    list: wrap("data.list", adapter.list.bind(adapter), (familyId, collection) => ({ familyId, collection })),
    get: wrap("data.get", adapter.get.bind(adapter), (familyId, collection, id) => ({
      familyId,
      collection,
      id,
    })),
    put: wrap("data.put", adapter.put.bind(adapter), (familyId, collection, doc) => ({
      familyId,
      collection,
      id: doc.id,
    })),
    remove: wrap("data.remove", adapter.remove.bind(adapter), (familyId, collection, id) => ({
      familyId,
      collection,
      id,
    })),
    commit: wrap("data.commit", adapter.commit.bind(adapter), (familyId, ops) => ({
      familyId,
      ...summarizeOps(ops),
    })),
  };
}

export { logError };
