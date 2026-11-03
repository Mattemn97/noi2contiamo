// Notifiche del browser (feature 19): solo mentre l'app è aperta, solo dopo un clic dell'utente.
// Niente Web Push: richiederebbe HTTPS e un servizio di push, che su un server di casa di solito non ci sono.
const PREF_KEY = "n2c.browserNotify";
const SEEN_KEY = "n2c.notified";
const SEEN_LIMIT = 200;

export type BrowserPermission = NotificationPermission | "unsupported";

export const browserPermission = (): BrowserPermission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage bloccato: la preferenza vale solo finché la pagina resta aperta.
  }
}

export const browserNotifyEnabled = (): boolean =>
  browserPermission() === "granted" && read(PREF_KEY) === "1";

/** Da chiamare solo dal gestore di un clic: chiede il permesso e salva la scelta. */
export async function enableBrowserNotify(): Promise<BrowserPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  const permission = await Notification.requestPermission();
  write(PREF_KEY, permission === "granted" ? "1" : "0");
  return permission;
}

export function disableBrowserNotify(): void {
  write(PREF_KEY, "0");
}

function seenKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface Notifiable {
  readonly dedupKey: string;
  readonly title: string;
  readonly body: string;
}

/** Mostra una notifica per ogni promemoria non ancora notificato su questo dispositivo. */
export function notifyOnce(items: readonly Notifiable[]): void {
  if (!browserNotifyEnabled()) return;
  const seen = new Set(seenKeys());
  const fresh = items.filter((item) => !seen.has(item.dedupKey));
  for (const item of fresh) {
    try {
      new Notification(item.title, { body: item.body, tag: item.dedupKey });
    } catch {
      return;
    }
    seen.add(item.dedupKey);
  }
  if (fresh.length > 0) write(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_LIMIT)));
}
