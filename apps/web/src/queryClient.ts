import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  // Gli errori attesi (401, 404) non si riprovano: si mostrano subito.
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
}
