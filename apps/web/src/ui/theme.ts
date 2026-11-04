// Preferenza del tema: leggi, salva, applica. La scelta vale per il dispositivo (localStorage `n2c.theme`).
// Lo script in linea di index.html fa la stessa lettura prima del primo disegno (niente lampo).
import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_KEY = "n2c.theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readThemePreference(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, preference);
  } catch {
    // Archivio non disponibile (navigazione privata): il tema vale solo per questa sessione.
  }
}

/** Allinea ogni `<meta name="theme-color">` al colore della pagina del tema attivo. */
export function syncThemeColor(root: HTMLElement = document.documentElement): void {
  const page = getComputedStyle(root).getPropertyValue("--color-page").trim();
  if (!page) return;
  for (const meta of root.ownerDocument.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = page;
  }
}

/** Mette `data-theme` su <html> (nessun attributo con "Sistema") e allinea il theme-color. */
export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  syncThemeColor(root);
}

/** Stato React della preferenza: applica subito, salva, e segue il sistema quando la scelta è "Sistema". */
export function useThemePreference(): readonly [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());

  useEffect(() => {
    applyThemePreference(preference);
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      syncThemeColor();
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [preference]);

  const update = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreference(next);
  }, []);

  return [preference, update] as const;
}
