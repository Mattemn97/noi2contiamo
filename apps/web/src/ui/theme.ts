// Preferenza del tema: leggi, salva, applica. La scelta vale per il dispositivo (localStorage `n2c.theme`).
// Lo script in linea di index.html fa la stessa lettura prima del primo disegno (niente lampo).
import { useCallback, useEffect, useSyncExternalStore } from "react";

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

export type AccentPreference = "green" | "blue" | "violet" | "pink" | "orange" | "graphite";

export const ACCENT_KEY = "n2c.accent";
export const ACCENT_PREFERENCES: readonly AccentPreference[] = [
  "green",
  "blue",
  "violet",
  "pink",
  "orange",
  "graphite",
];

export function parseAccentPreference(raw: string | null | undefined): AccentPreference {
  return ACCENT_PREFERENCES.find((accent) => accent === raw) ?? "green";
}

export function saveAccentPreference(
  preference: AccentPreference,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  try {
    if (preference === "green") storage?.removeItem(ACCENT_KEY);
    else storage?.setItem(ACCENT_KEY, preference);
  } catch {
    // Archivio non disponibile: il colore vale solo per questa sessione.
  }
}

/** Mette `data-accent` su <html>; il verde è il colore di base e non ha attributo. */
export function applyAccentPreference(
  preference: AccentPreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === "green") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", preference);
}

// Gli attributi su <html> sono la fonte di verità: più selettori nella stessa pagina restano allineati.
const APPEARANCE_CHANGE = "n2c:appearance";

function subscribeAppearance(onChange: () => void): () => void {
  window.addEventListener(APPEARANCE_CHANGE, onChange);
  return () => {
    window.removeEventListener(APPEARANCE_CHANGE, onChange);
  };
}

function announceAppearance(): void {
  window.dispatchEvent(new Event(APPEARANCE_CHANGE));
}

const currentTheme = (): ThemePreference =>
  parseThemePreference(document.documentElement.getAttribute("data-theme"));

const currentAccent = (): AccentPreference =>
  parseAccentPreference(document.documentElement.getAttribute("data-accent"));

/** Stato React del tema: applica subito, salva, e segue il sistema quando la scelta è "Sistema". */
export function useThemePreference(): readonly [ThemePreference, (next: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribeAppearance, currentTheme);

  useEffect(() => {
    syncThemeColor();
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
    applyThemePreference(next);
    announceAppearance();
  }, []);

  return [preference, update] as const;
}

/** Stato React del colore principale: applica subito e ricorda la scelta sul dispositivo. */
export function useAccentPreference(): readonly [AccentPreference, (next: AccentPreference) => void] {
  const preference = useSyncExternalStore(subscribeAppearance, currentAccent);

  const update = useCallback((next: AccentPreference) => {
    saveAccentPreference(next);
    applyAccentPreference(next);
    announceAppearance();
  }, []);

  return [preference, update] as const;
}
