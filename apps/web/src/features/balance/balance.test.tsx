// Saldo tra i membri nel DOM (spec 0005): chi deve a chi, pareggio, giroconti da riconoscere, modulo del giroconto.
import { defaultCategories, newId, totalsOf } from "@noi2contiamo/core";
import type { DataAdapter } from "@noi2contiamo/data";
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

/** Anna e Bruno con un conto ciascuno; Anna paga 100,01 € al 60/40 → Bruno deve 40,00 € ad Anna. */
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
  const invite = await adapter.membership.createInvite(familyId, { id: newId() });
  if (!invite.ok) throw new Error("invito");
  await adapter.auth.signUp("bruno@example.com", PASSWORD);
  await adapter.membership.acceptInvite(invite.value.token, "Bruno");
  await adapter.auth.signIn("anna@example.com", PASSWORD);
  const members = await adapter.list(familyId, "members");
  const partnerId = members.ok ? members.value.docs.find((m) => m.displayName === "Bruno")!.id : "";
  const annas = newId();
  const brunos = newId();
  for (const [id, name, owner] of [
    [annas, "Conto Anna", ownerId],
    [brunos, "Conto Bruno", partnerId],
  ] as const)
    await adapter.put(familyId, "accounts", {
      id,
      name,
      kind: "checking",
      ownerMemberId: owner,
      initialBalanceDate: "2026-01-01",
    });
  const categoryId = categories.find((c) => c.name === "Spesa Alimentare")!.id;
  await adapter.put(familyId, "transactions", {
    id: newId(),
    type: "expense",
    date: "2026-10-01",
    amountCents: 10001,
    description: "Spesa",
    accountId: annas,
    payerMemberId: ownerId,
    categoryId,
    split: { kind: "bp", source: "category", shares: { [ownerId]: 6000, [partnerId]: 4000 } },
  });
  return { adapter, familyId, ownerId, partnerId, annas, brunos, categoryId };
}

async function allTxs(adapter: DataAdapter, familyId: string) {
  const listed = await adapter.list(familyId, "transactions");
  if (!listed.ok) throw new Error("lista");
  return listed.value.docs;
}

describe("pagina Saldo (AC-7, AC-8, AC-10)", () => {
  it("mostra chi deve a chi e il dettaglio; il pareggio porta a 'Siete in pari'", async () => {
    const { adapter, familyId, ownerId, partnerId, annas, brunos } = await seeded();
    const user = userEvent.setup();
    renderApp(adapter, "/saldo");
    expect(await screen.findByText("Bruno deve 40,00 € a Anna")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Come si arriva al saldo di ogni membro" });
    expect(within(table).getByText("Bruno")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Registra pareggio" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Registra" }));
    expect(await screen.findByText("Siete in pari")).toBeTruthy();

    const settlement = (await allTxs(adapter, familyId)).find((t) => t.type === "transfer")!;
    expect(settlement).toMatchObject({
      amountCents: 4000,
      accountId: brunos,
      toAccountId: annas,
      settlement: { fromMemberId: partnerId, toMemberId: ownerId },
      description: "Pareggio",
    });
  });

  it("non ha violazioni axe", async () => {
    const { adapter } = await seeded();
    renderApp(adapter, "/saldo");
    await screen.findByText("Bruno deve 40,00 € a Anna");
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("riconosce una spesa e un'entrata uguali su due conti e le unisce in un giroconto (AC-9)", async () => {
    const { adapter, familyId, ownerId, annas, brunos, categoryId } = await seeded();
    const listed = await adapter.list(familyId, "categories");
    if (!listed.ok) throw new Error("categorie");
    const incomeCat = listed.value.docs.find((c) => c.kind === "income")!.id;
    const split = { kind: "bp" as const, source: "default" as const, shares: { [ownerId]: 10000 } };
    await adapter.put(familyId, "transactions", {
      id: newId(),
      type: "expense",
      date: "2026-10-10",
      amountCents: 5000,
      description: "Bonifico a Bruno",
      accountId: annas,
      categoryId,
      split,
    });
    await adapter.put(familyId, "transactions", {
      id: newId(),
      type: "income",
      date: "2026-10-11",
      amountCents: 5000,
      description: "Bonifico da Anna",
      accountId: brunos,
      categoryId: incomeCat,
      split,
    });
    const user = userEvent.setup();
    renderApp(adapter, "/saldo");
    const card = (await screen.findByRole("heading", { name: "Giroconti da riconoscere" })).closest(
      "section",
    )!;
    await user.click(within(card).getByRole("button", { name: "Unisci come giroconto" }));
    await waitFor(async () => {
      const txs = await allTxs(adapter, familyId);
      expect(txs.filter((t) => t.type === "transfer")).toHaveLength(1);
    });
    const txs = await allTxs(adapter, familyId);
    expect(txs).toHaveLength(2);
    expect(txs.find((t) => t.type === "transfer")).toMatchObject({
      accountId: annas,
      toAccountId: brunos,
      description: "Bonifico a Bruno",
    });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Giroconti da riconoscere" })).toBeNull();
    });
  });
});

describe("modulo del giroconto (AC-1, AC-2)", () => {
  it("salva un giroconto tra due conti senza cambiare i totali; due conti uguali sono rifiutati", async () => {
    const { adapter, familyId, annas, brunos } = await seeded();
    const before = totalsOf(await allTxs(adapter, familyId));
    const user = userEvent.setup();
    renderApp(adapter, "/movimenti/nuovo");
    await user.click(await screen.findByRole("radio", { name: "Giroconto" }));
    expect(screen.queryByText("Divisione tra i membri")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: /Importo/ }), "25");
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    expect(await screen.findByText("Scegli il conto di arrivo.", { selector: "li" })).toBeTruthy();
    const toSelect = screen.getByRole("button", { name: /Al conto/ });
    await user.click(toSelect);
    await user.click(await screen.findByRole("option", { name: "Conto Bruno" }));
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    await waitFor(async () => {
      expect((await allTxs(adapter, familyId)).some((t) => t.type === "transfer")).toBe(true);
    });
    const txs = await allTxs(adapter, familyId);
    expect(txs.find((t) => t.type === "transfer")).toMatchObject({
      amountCents: 2500,
      accountId: annas,
      toAccountId: brunos,
      split: null,
    });
    expect(totalsOf(txs)).toEqual({ ...before, count: before.count + 1 });
  });
});
