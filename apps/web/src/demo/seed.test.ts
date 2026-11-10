// Dati della demo del sito: si caricano senza errori di schema e lasciano una famiglia credibile.
import { describe, expect, it } from "vitest";
import { DEMO_EMAILS, DEMO_PASSWORD } from "./credentials";
import { createDemoAdapter } from "./seed";

describe("demo del sito", () => {
  it("crea Casa Demo con due membri, conti e movimenti, e lascia Giulia collegata", async () => {
    const adapter = await createDemoAdapter(new Date("2026-11-10T09:00:00Z"));
    expect((await adapter.auth.currentUser())?.email).toBe(DEMO_EMAILS.owner);

    const families = await adapter.membership.myFamilies();
    if (!families.ok) throw new Error("famiglie");
    expect(families.value.map((f) => f.family.name)).toEqual(["Casa Demo"]);
    const familyId = families.value[0]!.family.id;

    const members = await adapter.list(familyId, "members");
    const accounts = await adapter.list(familyId, "accounts");
    const txs = await adapter.list(familyId, "transactions", { limit: 500 });
    if (!members.ok || !accounts.ok || !txs.ok) throw new Error("liste");
    expect(members.value.docs.map((m) => m.displayName).sort()).toEqual(["Giulia", "Marco"]);
    expect(accounts.value.docs).toHaveLength(4);
    expect(txs.value.docs.length).toBeGreaterThan(80);
    expect(txs.value.docs.every((t) => t.date <= "2026-11-10")).toBe(true);
  });

  it("nasconde a Marco il conto privato di Giulia", async () => {
    const adapter = await createDemoAdapter(new Date("2026-11-10T09:00:00Z"));
    await adapter.auth.signIn(DEMO_EMAILS.partner, DEMO_PASSWORD);
    const families = await adapter.membership.myFamilies();
    if (!families.ok) throw new Error("famiglie");
    const accounts = await adapter.list(families.value[0]!.family.id, "accounts");
    if (!accounts.ok) throw new Error("conti");
    expect(accounts.value.docs.map((a) => a.name)).not.toContain("Risparmi di Giulia");
  });
});
