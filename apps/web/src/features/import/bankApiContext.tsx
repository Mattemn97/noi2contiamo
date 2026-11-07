// Il client della banca per l'albero React: i test ne passano uno con `fetch` finto.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createDefaultBankApi, type BankApi } from "./bankApi";

interface BankEnv {
  readonly api: BankApi;
  /** Va sul sito della banca (nei test: una funzione che registra l'indirizzo). */
  readonly redirect: (url: string) => void;
}

const BankContext = createContext<BankEnv | null>(null);

export function BankApiProvider({
  api,
  redirect,
  children,
}: {
  readonly api: BankApi;
  readonly redirect?: (url: string) => void;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      api,
      redirect:
        redirect ??
        ((url: string) => {
          window.location.assign(url);
        }),
    }),
    [api, redirect],
  );
  return <BankContext.Provider value={value}>{children}</BankContext.Provider>;
}

export function useBank(): BankEnv {
  const provided = useContext(BankContext);
  const fallback = useMemo<BankEnv>(
    () => ({
      api: createDefaultBankApi(),
      redirect: (url) => {
        window.location.assign(url);
      },
    }),
    [],
  );
  return provided ?? fallback;
}
