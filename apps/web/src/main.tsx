import type { DataAdapter } from "@noi2contiamo/data";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router";
import { loadAdapter } from "./adapter";
import { applyDebugParam, logError, logInfo } from "./debug/log";
import { withLogging } from "./debug/loggedAdapter";
import { AdapterProvider } from "./data/AdapterContext";
import { createQueryClient } from "./queryClient";
import { routes } from "./routes";
import { UiProvider } from "./ui";
import "./ui/tokens.css";
import "./ui/accents.css";
import "./ui/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root mancante");

// Catalogo dei componenti solo in sviluppo: in produzione il ramo sparisce dal bundle.
const UiCatalog = import.meta.env.DEV
  ? lazy(() => import("./dev/UiCatalog").then((module) => ({ default: module.UiCatalog })))
  : null;

// Fascia della demo del sito: solo in quella build.
const DemoBanner =
  import.meta.env.VITE_BACKEND === "demo"
    ? lazy(() => import("./demo/DemoBanner").then((module) => ({ default: module.DemoBanner })))
    : null;

function render(adapter: DataAdapter, container: HTMLElement) {
  // La demo sta in una sottocartella di GitHub Pages, che non sa riscrivere i percorsi verso index.html.
  const demo = import.meta.env.VITE_BACKEND === "demo";
  const router = demo ? createHashRouter(routes) : createBrowserRouter(routes);
  // Solo il percorso: i parametri possono contenere codici di accesso (ritorno dalla banca, inviti).
  router.subscribe((state) => {
    logInfo("nav", { path: state.location.pathname });
  });
  const page =
    UiCatalog && window.location.pathname === "/dev/ui" ? <UiCatalog /> : <RouterProvider router={router} />;
  createRoot(container).render(
    <StrictMode>
      <UiProvider>
        {DemoBanner ? (
          <Suspense fallback={null}>
            <DemoBanner />
          </Suspense>
        ) : null}
        <AdapterProvider adapter={adapter}>
          <QueryClientProvider client={createQueryClient()}>
            <Suspense fallback={null}>{page}</Suspense>
          </QueryClientProvider>
        </AdapterProvider>
      </UiProvider>
    </StrictMode>,
  );
}

applyDebugParam(window.location.search);
window.addEventListener("error", (event) => {
  logError("window.error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  logError("window.unhandledrejection", event.reason);
});

void loadAdapter().then((adapter) => {
  logInfo("app.start", {
    backend: import.meta.env.VITE_BACKEND,
    version: import.meta.env.VITE_APP_VERSION ?? "dev",
    path: window.location.pathname,
  });
  render(withLogging(adapter), root);
});
