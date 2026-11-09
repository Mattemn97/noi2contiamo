import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { logError } from "./debug/log";

export function createQueryClient(): QueryClient {
  // Gli errori attesi (401, 404) non si riprovano: si mostrano subito. Ogni errore finisce anche nel
  // registro di diagnostica, con la chiave della query (collezione e id accorciati, mai i dati).
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        logError("query.error", error, { path: query.queryKey.map(String).join("/") });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        logError("mutation.error", error, {
          step: mutation.options.mutationKey?.map(String).join("/") ?? "",
        });
      },
    }),
  });
}
