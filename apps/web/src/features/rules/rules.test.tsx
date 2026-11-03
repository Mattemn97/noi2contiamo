// Regole automatiche nel DOM (adapter memory) e le funzioni pure del modulo (spec 0007).
import { defaultCategories, newId, type Rule } from "@noi2contiamo/core";
import type { DataAdapter, WriteDocOf } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../../data/AdapterContext";
import { createQueryClient } from "../../queryClient";
import { routes } from "../../routes";
import { UiProvider } from "../../ui";
import { buildTransaction } from "../transactions/newTransaction";
import { describeRule, emptyForm, formOf, ruleOf } from "./ruleForm";
import { lastYearRange } from "./RulePreview";

const PASSWORD = "password-di-prova";

function renderApp(adapter: DataAdapter, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <UiProvider>
      <AdapterProvider adapter={adapter}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AdapterProvider>
    </UiProvider>,
  );
  return router;
}

const today = lastYearRange().to;

async function seeded() {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", PASSWORD);
  const familyId = newId();
  const ownerId = newId();
  const categories = defaultCategories();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa Rossi" },
    ownerMember: { id: ownerId, displayName: "Anna" },
    defaults: { categories },
  });
  const accountId = newId();
  await adapter.put(familyId, "accounts", {
    id: accountId,
    name: "Conto comune",
    kind: "checking",
    initialBalanceDate: "2026-01-01",
  });
  const spesa = categories.find((c) => c.name === "Spesa Alimentare")!.id;
  const svago = categories.find((c) => c.kind === "expense" && c.id !== spesa && !c.parentId)!.id;
  const tx = (patch: Partial<WriteDocOf<"transactions">> = {}): WriteDocOf<"transactions"> => ({
    id: newId(),
    type: "expense",
    date: today,
    amountCents: 4530,
    accountId,
    description: "PAGAMENTO POS ESSELUNGA 1234 MILANO",
    split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
    provenance: { category: "default", payee: "default", split: "default" },
    ...patch,
  });
  return { adapter, familyId, ownerId, accountId, spesa, svago, tx };
}

const docs = async <C extends "rules" | "transactions" | "payees">(
  adapter: DataAdapter,
  familyId: string,
  c: C,
) => {
  const r = await adapter.list(familyId, c);
  if (!r.ok) throw new Error("lettura");
  return r.value.docs;
};

describe("lista delle regole (AC-14, AC-10)", () => {
  it("mostra l'ordine, riordina con Su e Giù e applica ai movimenti senza toccare il manuale", async () => {
    const user = userEvent.setup();
    const s = await seeded();
    const payeeId = newId();
    await s.adapter.put(s.familyId, "payees", {
      id: payeeId,
      name: "Esselunga",
      normalizedName: "esselunga",
    });
    const first: WriteDocOf<"rules"> = {
      id: newId(),
      name: "Esselunga",
      order: 0,
      conditions: { description: { op: "contains", value: "esselunga" } },
      actions: { categoryId: s.spesa, payeeId },
    };
    const second: WriteDocOf<"rules"> = {
      id: newId(),
      name: "Generica",
      order: 1,
      enabled: false,
      conditions: { types: ["expense"] },
      actions: { recurring: true },
    };
    await s.adapter.commit(s.familyId, [
      { type: "put", collection: "rules", doc: first },
      { type: "put", collection: "rules", doc: second },
    ]);
    const manual = s.tx({
      categoryId: s.svago,
      provenance: { category: "manual", payee: "default", split: "default" },
    });
    await s.adapter.put(s.familyId, "transactions", manual);
    renderApp(s.adapter, "/altro/regole");

    const list = await screen.findByRole("list", { name: "Regole automatiche" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("1. Esselunga");
    expect(items[0]!.textContent).toContain("descrizione contiene «esselunga»");
    expect(items[0]!.textContent).toContain("destinatario Esselunga");
    expect(items[1]!.textContent).toContain("Disattivata");
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sposta giù la regola Esselunga" }));
    await waitFor(async () => {
      const saved = (await docs(s.adapter, s.familyId, "rules")).sort(
        (a: Rule, b: Rule) => a.order - b.order,
      );
      expect(saved.map((r) => r.name)).toEqual(["Generica", "Esselunga"]);
    });

    await user.click(screen.getByRole("button", { name: "Applica a tutti i movimenti" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Cambiano 1 movimenti");
    await user.click(within(dialog).getByRole("button", { name: "Applica" }));
    await waitFor(async () => {
      const [tx] = await docs(s.adapter, s.familyId, "transactions");
      expect(tx).toMatchObject({
        categoryId: s.svago,
        payeeId,
        provenance: { category: "manual", payee: "rule" },
      });
    });
  });
});

describe("regola da un movimento con anteprima (AC-11, AC-12, AC-13)", () => {
  it("precompila nome, destinatario e categoria, mostra l'anteprima e salva con il destinatario nuovo", async () => {
    const user = userEvent.setup();
    const s = await seeded();
    const tx = s.tx({
      categoryId: s.spesa,
      provenance: { category: "manual", payee: "manual", split: "default" },
    });
    await s.adapter.put(s.familyId, "transactions", tx);
    await s.adapter.put(s.familyId, "transactions", s.tx({ description: "Esselunga via Roma" }));
    await s.adapter.put(
      s.familyId,
      "transactions",
      s.tx({ categoryId: s.svago, provenance: { category: "manual", payee: "default", split: "default" } }),
    );
    renderApp(s.adapter, `/altro/regole/nuova?movimento=${tx.id}`);

    expect(await screen.findByRole("heading", { name: "Nuova regola" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Nome della regola/).value).toBe("Esselunga");
    expect(screen.getByLabelText<HTMLInputElement>(/^Testo/).value).toBe("esselunga");
    expect(screen.getByRole<HTMLInputElement>("combobox", { name: /^Destinatario/ }).value).toBe("Esselunga");
    expect(await screen.findByText("Prende 3 movimenti, ne cambierebbe 1.")).toBeTruthy();
    expect(screen.getAllByText(/modificato a mano/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Salva regola" }));
    await waitFor(async () => {
      const [rule] = await docs(s.adapter, s.familyId, "rules");
      const payees = await docs(s.adapter, s.familyId, "payees");
      expect(payees.map((p) => p.name)).toEqual(["Esselunga"]);
      expect(rule).toMatchObject({
        name: "Esselunga",
        order: 0,
        conditions: { types: ["expense"], description: { op: "contains", value: "esselunga" } },
        actions: { categoryId: s.spesa, payeeId: payees[0]!.id },
      });
    });
  });

  it("una regola non valida mostra il motivo e non si salva", async () => {
    const user = userEvent.setup();
    const s = await seeded();
    renderApp(s.adapter, "/altro/regole/nuova");
    await user.click(await screen.findByRole("button", { name: "Salva regola" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/serve almeno/);
    expect(await docs(s.adapter, s.familyId, "rules")).toEqual([]);
  });
});

describe("suggerimento nel nuovo movimento (AC-9)", () => {
  it("la regola propone la categoria e il movimento salva provenienza rule", async () => {
    const user = userEvent.setup();
    const s = await seeded();
    const ruleId = newId();
    await s.adapter.put(s.familyId, "rules", {
      id: ruleId,
      name: "Spesa al super",
      conditions: { description: { op: "contains", value: "esselunga" } },
      actions: { categoryId: s.spesa, recurring: true },
    });
    renderApp(s.adapter, "/movimenti/nuovo");
    await user.type(await screen.findByLabelText(/^Importo/), "12,50");
    await user.type(screen.getByLabelText(/^Descrizione/), "Esselunga");
    expect(await screen.findByText("Suggerito dalla regola «Spesa al super»")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    await waitFor(async () => {
      const [tx] = await docs(s.adapter, s.familyId, "transactions");
      expect(tx).toMatchObject({ categoryId: s.spesa, provenance: { category: "rule" }, ruleIds: [ruleId] });
    });
  });
});

describe("funzioni del modulo", () => {
  const A = newId();
  const P = newId();
  const C = newId();

  it("ruleOf e formOf vanno e tornano, senza chiavi vuote", () => {
    const form = {
      ...emptyForm([A]),
      name: " Bar ",
      descOp: "pattern" as const,
      descValue: "bar *",
      categoryId: C,
      payeeText: "Bar Sport",
      splitOn: true,
      split: { kind: "bp" as const, shares: { [A]: 10000 } },
    };
    const payees = [
      {
        id: P,
        name: "Bar Sport",
        normalizedName: "bar sport",
        archivedAtMs: null,
        createdAtMs: 1,
        createdByMemberId: A,
        updatedAtMs: 1,
        updatedByMemberId: A,
      },
    ];
    const { rule, createPayee } = ruleOf(form, { id: newId(), order: 3 }, payees, newId);
    expect(createPayee).toBeNull();
    expect(rule.conditions).toEqual({
      match: "all",
      types: ["expense"],
      description: { op: "pattern", value: "bar *" },
    });
    expect(rule.actions).toEqual({
      categoryId: C,
      payeeId: P,
      split: { kind: "bp", shares: { [A]: 10000 } },
    });
    expect(rule.name).toBe("Bar");
    const back = formOf(rule, payees, [A]);
    expect(back).toMatchObject({ descOp: "pattern", payeeText: "Bar Sport", splitOn: true, categoryId: C });
    const transfer = ruleOf({ ...form, transferAccountId: P }, { id: newId(), order: 0 }, payees, newId);
    expect(transfer.rule.actions).toEqual({ payeeId: P, transferAccountId: P });
  });

  it("describeRule in italiano, con i riferimenti mancanti", () => {
    const text = describeRule(
      {
        conditions: { match: "any", types: ["expense"], amountMinCents: 1000, amountMaxCents: 5000 },
        actions: { categoryId: C, recurring: true },
      },
      { category: () => null, payee: () => null, account: () => null, member: () => null },
    );
    expect(text.replace(/\s/g, " ")).toBe(
      "Se tipo spesa oppure importo tra 10,00 € e 50,00 € → categoria (non esiste più), ricorrente",
    );
  });

  it("buildTransaction: i campi suggeriti hanno provenienza rule e la regola entra in ruleIds", async () => {
    const s = await seeded();
    const fam = await s.adapter.membership.myFamilies();
    const family = fam.ok ? fam.value[0]!.family : null;
    const accounts = await s.adapter.list(s.familyId, "accounts");
    const categories = await s.adapter.list(s.familyId, "categories");
    if (!family || !accounts.ok || !categories.ok) throw new Error("setup");
    const r1 = newId();
    const r2 = newId();
    const built = buildTransaction(
      {
        type: "expense",
        amountCents: 100,
        date: today,
        categoryId: s.spesa,
        accountId: s.accountId,
        description: "x",
        payeeId: null,
        rule: {
          category: r1,
          payee: r2,
          split: { spec: { kind: "bp", shares: { [s.ownerId]: 10000 } }, ruleId: r2 },
          recurring: [r1],
        },
      },
      { id: newId(), family, accounts: accounts.value.docs, categories: categories.value.docs },
    );
    if (!built.ok) throw new Error("build");
    expect(built.value.provenance).toEqual({ category: "rule", payee: "manual", split: "rule" });
    expect(built.value.split?.source).toBe("rule");
    expect(built.value.ruleIds).toEqual([r1, r2]);
  });
});
