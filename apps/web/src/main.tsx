import type { DataAdapter } from "@noi2contiamo/data";
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { loadAdapter } from "./adapter";
import { AdapterProvider } from "./data/AdapterContext";
import { createQueryClient } from "./queryClient";
import { routes } from "./routes";
import { UiProvider } from "./ui";
import "./ui/tokens.css";
import "./ui/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root mancante");

// Catalogo dei componenti solo in sviluppo: in produzione il ramo sparisce dal bundle.
const UiCatalog = import.meta.env.DEV
  ? lazy(() => import("./dev/UiCatalog").then((module) => ({ default: module.UiCatalog })))
  : null;

function render(adapter: DataAdapter, container: HTMLElement) {
  const router = createBrowserRouter(routes);
  const page =
    UiCatalog && window.location.pathname === "/dev/ui" ? <UiCatalog /> : <RouterProvider router={router} />;
  createRoot(container).render(
    <StrictMode>
      <UiProvider>
        <AdapterProvider adapter={adapter}>
          <QueryClientProvider client={createQueryClient()}>
            <Suspense fallback={null}>{page}</Suspense>
          </QueryClientProvider>
        </AdapterProvider>
      </UiProvider>
    </StrictMode>,
  );
}

void loadAdapter().then((adapter) => {
  render(adapter, root);
});
