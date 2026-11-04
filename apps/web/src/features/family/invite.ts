// Inviti nel browser: dal testo incollato (codice o link) al token, e la famiglia attiva ricordata.
import type { FamilySummary } from "@noi2contiamo/data";

const TOKEN = /^[a-z2-7]{26}$/;

/** Accetta il codice da solo o il link intero (`…/invito/<codice>`); null se non è un codice valido. */
export function parseInviteCode(input: string): string | null {
  const last = input.trim().split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1) ?? "";
  const code = last.toLowerCase().replace(/\s+/g, "");
  return TOKEN.test(code) ? code : null;
}

export function inviteLink(origin: string, token: string): string {
  return `${origin}/invito/${token}`;
}

const ACTIVE_KEY = "n2c.activeFamily";

/** La famiglia scelta per ultima su questo dispositivo, se c'è ancora; altrimenti la prima. */
export function pickActiveFamily(
  families: readonly FamilySummary[],
  storedId: string | null,
): FamilySummary | undefined {
  return families.find((f) => f.family.id === storedId) ?? families[0];
}

export function readActiveFamily(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function storeActiveFamily(familyId: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, familyId);
  } catch {
    // Storage bloccato (finestra privata): resta la prima famiglia.
  }
}
