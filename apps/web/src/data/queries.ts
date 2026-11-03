// Dati remoti con TanStack Query sopra il DataAdapter: stesse chiavi e stessi stati per i due backend.
import type { DateRange, Result, Transaction } from "@noi2contiamo/core";
import type { CollectionName, Cursor, DataError, DocOf, FamilySummary, User } from "@noi2contiamo/data";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAdapter } from "./AdapterContext";

/** Errore atteso del DataAdapter, lanciato dentro la query così React Query lo mostra come `error`. */
export class DataQueryError extends Error {
  constructor(readonly error: DataError) {
    super(error.code);
    this.name = "DataQueryError";
  }
}

export function unwrap<T>(result: Result<T, DataError>): T {
  if (!result.ok) throw new DataQueryError(result.error);
  return result.value;
}

export const keys = {
  session: ["session"] as const,
  families: ["families"] as const,
  collection: (familyId: string, collection: CollectionName) => ["family", familyId, collection] as const,
  family: (familyId: string) => ["family", familyId] as const,
};

export function useSession(): UseQueryResult<User | null> {
  const adapter = useAdapter();
  return useQuery({ queryKey: keys.session, queryFn: () => adapter.auth.currentUser() });
}

export function useFamilies(enabled = true): UseQueryResult<FamilySummary[]> {
  const adapter = useAdapter();
  return useQuery({
    queryKey: keys.families,
    queryFn: async () => unwrap(await adapter.membership.myFamilies()),
    enabled,
  });
}

/** Tutti i documenti visibili di una collezione (il filo base resta sotto i 500 per pagina). */
export function useCollection<C extends CollectionName>(
  familyId: string | undefined,
  collection: C,
): UseQueryResult<DocOf<C>[]> {
  const adapter = useAdapter();
  return useQuery({
    queryKey: keys.collection(familyId ?? "", collection),
    queryFn: async () => unwrap(await adapter.list(familyId ?? "", collection)).docs,
    enabled: familyId !== undefined,
  });
}

/** Tutte le pagine di una collezione (per i saldi servono tutti i movimenti, non solo i primi 500). */
export function useAllDocs<C extends CollectionName>(
  familyId: string | undefined,
  collection: C,
): UseQueryResult<DocOf<C>[]> {
  const adapter = useAdapter();
  return useQuery({
    queryKey: [...keys.collection(familyId ?? "", collection), "all"],
    queryFn: async () => {
      const docs: DocOf<C>[] = [];
      let after: Cursor | undefined;
      do {
        const page = unwrap(await adapter.list(familyId ?? "", collection, after ? ({ after }) : {}));
        docs.push(...page.docs);
        after = page.next ?? undefined;
      } while (after);
      return docs;
    },
    enabled: familyId !== undefined,
  });
}

/**
 * I movimenti visibili di un periodo, tutte le pagine col cursore dell'adapter (500 per volta).
 * Il periodo va al backend come intervallo di date; gli altri filtri li applica `core` (spec 0002).
 */
export function useTransactionsInRange(
  familyId: string | undefined,
  range: DateRange,
): UseQueryResult<Transaction[]> {
  const adapter = useAdapter();
  return useQuery({
    queryKey: [...keys.collection(familyId ?? "", "transactions"), "range", range.from, range.to],
    queryFn: async () => {
      const docs: Transaction[] = [];
      let after: Cursor | undefined;
      do {
        const page = unwrap(
          await adapter.list(familyId ?? "", "transactions", {
            ...(range.from !== null ? { dateFrom: range.from } : {}),
            ...(range.to !== null ? { dateTo: range.to } : {}),
            ...(after ? { after } : {}),
          }),
        );
        docs.push(...page.docs);
        after = page.next ?? undefined;
      } while (after);
      return docs;
    },
    enabled: familyId !== undefined,
  });
}

/** Dopo un cambio di sessione si butta via tutto quello che apparteneva all'utente di prima. */
export function useResetAfterAuth(): (user: User | null) => void {
  const client = useQueryClient();
  return (user) => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    client.setQueryData(keys.session, user);
  };
}
