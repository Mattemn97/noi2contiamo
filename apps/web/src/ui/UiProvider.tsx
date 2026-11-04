// Contesto comune dell'interfaccia: locale it-IT di React Aria (settimana da lunedì) e notifiche.
import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";
import { LOCALE } from "./format";
import { ToastProvider } from "./Toast/Toast";

export function UiProvider({ children }: { readonly children: ReactNode }) {
  return (
    <I18nProvider locale={LOCALE}>
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}
