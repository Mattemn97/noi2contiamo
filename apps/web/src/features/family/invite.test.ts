import type { FamilySummary } from "@noi2contiamo/data";
import { describe, expect, it } from "vitest";
import { pendingInvites } from "./FamilyPage";
import { inviteLink, parseInviteCode, pickActiveFamily } from "./invite";

const CODE = "abcdefghijklmnopqrstuvwxyz";

describe("codice di invito", () => {
  it("accetta il codice da solo, con spazi o maiuscole, e il link intero", () => {
    expect(parseInviteCode(CODE)).toBe(CODE);
    expect(parseInviteCode(`  ${CODE.toUpperCase()} `)).toBe(CODE);
    expect(parseInviteCode(inviteLink("https://casa.example", CODE))).toBe(CODE);
    expect(parseInviteCode(`https://casa.example/invito/${CODE}?x=1`)).toBe(CODE);
  });

  it("rifiuta testi che non sono un codice", () => {
    expect(parseInviteCode("")).toBeNull();
    expect(parseInviteCode("abc")).toBeNull();
    expect(parseInviteCode(`${CODE}1`)).toBeNull();
    expect(parseInviteCode("abcdefghijklmnopqrstuvwxy0")).toBeNull();
  });
});

describe("famiglia attiva", () => {
  const summary = (id: string): FamilySummary =>
    ({ family: { id }, memberId: "m", role: "member" }) as unknown as FamilySummary;

  it("usa quella salvata se c'è ancora, altrimenti la prima", () => {
    const families = [summary("a"), summary("b")];
    expect(pickActiveFamily(families, "b")?.family.id).toBe("b");
    expect(pickActiveFamily(families, "z")?.family.id).toBe("a");
    expect(pickActiveFamily(families, null)?.family.id).toBe("a");
    expect(pickActiveFamily([], "a")).toBeUndefined();
  });
});

describe("inviti in attesa", () => {
  const invite = (patch: object) =>
    ({ id: "i", usedAtMs: null, revokedAtMs: null, expiresAtMs: 100, createdAtMs: 1, ...patch }) as never;

  it("tiene solo quelli non usati, non revocati e non scaduti, dal più nuovo", () => {
    const list = [
      invite({ id: "vecchio", createdAtMs: 1 }),
      invite({ id: "nuovo", createdAtMs: 5 }),
      invite({ id: "usato", usedAtMs: 3 }),
      invite({ id: "revocato", revokedAtMs: 3 }),
      invite({ id: "scaduto", expiresAtMs: 50 }),
    ];
    expect(pendingInvites(list, 50).map((i: { id: string }) => i.id)).toEqual(["nuovo", "vecchio"]);
  });
});
