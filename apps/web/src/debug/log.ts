// Registro di diagnostica nella console del browser. Gli errori si scrivono sempre; il resto solo con
// il registro acceso (Altro > Diagnostica, oppure `?debug=1` nell'indirizzo, `?debug=0` per spegnerlo).
// Ogni dettaglio passa da `redact`: niente importi, descrizioni, nomi, email, token o chiavi.
import { describeError, redact } from "./redact";

const STORAGE_KEY = "n2c:debug";
const PREFIX = "[N2C]";

export function isDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage bloccato (navigazione privata): il registro resta spento, gli errori si vedono comunque.
  }
}

/** `?debug=1` / `?debug=0` nell'indirizzo accende o spegne il registro, una volta all'avvio. */
export function applyDebugParam(search: string): void {
  const value = new URLSearchParams(search).get("debug");
  if (value === "1" || value === "0") setDebugEnabled(value === "1");
}

const time = () => new Date().toISOString().slice(11, 23);

export function logInfo(event: string, details: Readonly<Record<string, unknown>> = {}): void {
  if (!isDebugEnabled()) return;
  console.info(PREFIX, time(), event, redact(details));
}

export function logWarn(event: string, details: Readonly<Record<string, unknown>> = {}): void {
  if (!isDebugEnabled()) return;
  console.warn(PREFIX, time(), event, redact(details));
}

export function logError(
  event: string,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): void {
  console.error(PREFIX, time(), event, { ...redact(details), error: describeError(error) });
}

/** Misura un'operazione asincrona e la registra con durata ed esito. */
export async function timed<T>(
  event: string,
  details: Readonly<Record<string, unknown>>,
  run: () => Promise<T>,
  outcome: (value: T) => Readonly<Record<string, unknown>> = () => ({}),
): Promise<T> {
  const start = performance.now();
  try {
    const value = await run();
    logInfo(event, { ...details, ...outcome(value), duration: Math.round(performance.now() - start) });
    return value;
  } catch (error) {
    logError(event, error, { ...details, duration: Math.round(performance.now() - start) });
    throw error;
  }
}
