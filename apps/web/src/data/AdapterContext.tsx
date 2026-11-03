// L'adapter dati scelto al momento della build, a disposizione di tutte le pagine.
import type { DataAdapter } from "@noi2contiamo/data";
import { createContext, useContext, type ReactNode } from "react";

const AdapterContext = createContext<DataAdapter | null>(null);

export function AdapterProvider({ adapter, children }: { readonly adapter: DataAdapter; readonly children: ReactNode }) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useAdapter(): DataAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error("useAdapter va usato dentro <AdapterProvider>");
  return adapter;
}
