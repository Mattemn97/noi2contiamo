// Conti, categorie e destinatari nel DOM (adapter memory) e le funzioni pure delle pagine.
import { defaultCategories, newId, type Category } from "@noi2contiamo/core";
import type { DataAdapter } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../../data/AdapterContext";
import { createQueryClient } from "../../queryClient";
import { routes } from "../../routes";
import { UiProvider } from "../../ui";
import { resolvePayee } from "../transactions/newTransaction";
import { ownershipFields, ownershipOf } from "./AccountsPage";
import { categoryLabel, categoryTree, splitFromShares } from "./CategoriesPage";

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

async function seeded() {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", "password-di-prova");
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
    initialBalanceCents: 100000,
    initialBalanceDate: "2026-01-01",
  });
  await adapter.put(familyId, "transactions", {
    id: newId(),
    type: "expense",
    date: "2026-11-03",
    amountCents: 4250,
    accountId,
    categoryId: categories.find((c) => c.name === "Spesa Alimentare")!.id,
    split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
  });
  return { adapter, familyId };
}

describe("pagina conti", () => {
  it("mostra il saldo calcolato dai movimenti e crea un conto personale privato", async () => {
    const user = userEvent.setup();
    const { adapter, familyId } = await seeded();
    renderApp(adapter, "/altro/conti");
    const balance = await screen.findByLabelText("Saldo Conto comune");
    expect(balance.textContent).toContain("957,50");

    await user.click(screen.getByRole("button", { name: "Nuovo conto" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Nome del conto/), "Carta di Anna");
    await user.click(within(dialog).getByRole("radio", { name: "Mio, privato" }));
    await user.click(within(dialog).getByRole("button", { name: "Salva" }));
    expect(await screen.findByLabelText("Saldo Carta di Anna")).toBeTruthy();
    const listed = await adapter.list(familyId, "accounts");
    const card = listed.ok ? listed.value.docs.find((a) => a.name === "Carta di Anna") : undefined;
    expect(card).toMatchObject({ visibility: "private" });
    expect(card?.ownerMemberId).not.toBeNull();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("un nome già usato mostra il messaggio di doppione", async () => {
    const user = userEvent.setup();
    const { adapter } = await seeded();
    renderApp(adapter, "/altro/conti");
    await user.click(await screen.findByRole("button", { name: "Nuovo conto" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Nome del conto/), "conto comune");
    await user.click(within(dialog).getByRole("button", { name: "Salva" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Esiste già una voce con questo nome.",
    );
  });

  it("chi possiede il conto, avanti e indietro", () => {
    expect(ownershipFields("shared", "m")).toEqual({ ownerMemberId: null, visibility: "shared" });
    expect(ownershipFields("mine", "m")).toEqual({ ownerMemberId: "m", visibility: "shared" });
    expect(ownershipOf(ownershipFields("private", "m"))).toBe("private");
  });
});

describe("pagina categorie e destinatari", () => {
  it("le categorie mostrano le principali con i figli sotto, senza violazioni axe", async () => {
    const { adapter } = await seeded();
    renderApp(adapter, "/altro/categorie");
    expect(await screen.findByText("Spesa Alimentare")).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("un destinatario si crea dalla sua pagina", async () => {
    const user = userEvent.setup();
    const { adapter, familyId } = await seeded();
    renderApp(adapter, "/altro/destinatari");
    await user.click(await screen.findByRole("button", { name: "Nuovo destinatario" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Nome/), "Caffè Roma");
    await user.click(within(dialog).getByRole("button", { name: "Salva" }));
    expect(await screen.findByText("Caffè Roma")).toBeTruthy();
    const listed = await adapter.list(familyId, "payees");
    expect(listed.ok && listed.value.docs.map((p) => p.normalizedName)).toEqual(["caffe roma"]);
  });

  const cat = (patch: Partial<Category>) =>
    ({
      id: "c",
      name: "Casa",
      kind: "expense",
      parentId: null,
      order: 0,
      archivedAtMs: null,
      ...patch,
    }) as Category;

  it("albero, etichette e divisione predefinita", () => {
    const all = [
      cat({ id: "p", name: "Casa" }),
      cat({ id: "a", name: "Affitto", parentId: "p" }),
      cat({ id: "s", name: "Salute", order: 1 }),
    ];
    expect(categoryTree(all).map((r) => `${r.depth}:${r.category.name}`)).toEqual([
      "0:Casa",
      "1:Affitto",
      "0:Salute",
    ]);
    expect(categoryLabel(all[1]!, all)).toBe("Casa › Affitto");
    expect(splitFromShares({ a: 6000 as never, b: 4000 as never })).toEqual({
      kind: "bp",
      shares: { a: 6000, b: 4000 },
    });
    expect(splitFromShares({ a: 6000 as never, b: null })).toBe("invalid");
  });

  it("il destinatario del movimento: esistente per nome normalizzato, nuovo altrimenti, nessuno se vuoto", () => {
    const payees = [
      { id: "x", name: "Caffè Roma", normalizedName: "caffe roma", archivedAtMs: null },
    ] as never;
    expect(resolvePayee(" CAFFE roma ", payees, () => "n")).toEqual({ payeeId: "x", create: null });
    expect(resolvePayee("Bar Sport", payees, () => "n")).toEqual({
      payeeId: "n",
      create: { id: "n", name: "Bar Sport", normalizedName: "bar sport" },
    });
    expect(resolvePayee("  ", payees, () => "n")).toEqual({ payeeId: null, create: null });
  });
});
