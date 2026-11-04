import type { DataAdapter } from "@noi2contiamo/data";

/**
 * Carica l'adapter scelto al momento della build. VITE_BACKEND è una costante nota a Vite,
 * quindi il ramo non scelto (e il suo SDK) resta fuori dal bundle.
 */
export async function loadAdapter(): Promise<DataAdapter> {
  if (import.meta.env.VITE_BACKEND === "firebase") {
    const { createFirebaseAdapter } = await import("@noi2contiamo/data/firebase");
    const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true";
    return createFirebaseAdapter({
      app: {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      },
      ...(useEmulator
        ? { emulator: { authUrl: "http://127.0.0.1:9099", firestoreHost: "127.0.0.1", firestorePort: 8080 } }
        : {}),
    });
  }
  const { createHttpAdapter } = await import("@noi2contiamo/data/http");
  return createHttpAdapter();
}
