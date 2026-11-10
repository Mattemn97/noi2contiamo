import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // `--mode firebase` sceglie Firebase, `--mode demo` la demo in memoria del sito; altrimenti vale VITE_BACKEND,
  // con default `http`.
  const backend = env.VITE_BACKEND ?? (mode === "firebase" || mode === "demo" ? mode : "http");
  if (backend !== "http" && backend !== "firebase" && backend !== "demo") {
    throw new Error(`VITE_BACKEND non valido: ${backend} (usa "http", "firebase" oppure "demo")`);
  }
  const demo = backend === "demo";

  return {
    // La demo vive in una sottocartella del sito (GitHub Pages): percorsi relativi e router con l'hash.
    base: demo ? "./" : "/",
    define: {
      "import.meta.env.VITE_BACKEND": JSON.stringify(backend),
      // Versione del repository, per riconoscere nel registro di diagnostica quale build gira.
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(
        (
          JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
            version: string;
          }
        ).version,
      ),
    },
    plugins: [
      react(),
      VitePWA({
        // La demo non si installa: niente service worker che resti in cache dopo una nuova versione.
        disable: demo,
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Noi2Contiamo",
          short_name: "Noi2Contiamo",
          description: "La contabilità di coppia e di famiglia.",
          lang: "it",
          start_url: "/",
          display: "standalone",
          background_color: "#f9f9f7",
          theme_color: "#f9f9f7",
          icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      proxy: { "/api": "http://127.0.0.1:8000" },
    },
  };
});
