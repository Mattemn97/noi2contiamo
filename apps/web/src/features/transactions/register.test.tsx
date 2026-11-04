// Il registro nel DOM (adapter memory): filtri nell'URL, totali che tornano, modifica, cancellazione, stati.
import { defaultCategories, err, newId, type WriteDocOf } from "@noi2contiamo/core";
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

async function seeded(extra = 0) {
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
    initialBalanceDate: "2026-01-01",
  });
  const payeeId = newId();
  await adapter.put(familyId, "payees", { id: payeeId, name: "Coop", normalizedName: "coop" });
  const food = categories.find((c) => c.name === "Spesa Alimentare")!.id;
  const income = categories.find((c) => c.kind === "income")!.id;
  const split = { kind: "bp" as const, source: "default" as const, shares: { [ownerId]: 10000 } };
  const tx = (patch: Partial<WriteDocOf<"transactions">>): WriteDocOf<"transactions"> => ({
    id: newId(),
    type: "expense",
    date: "2026-10-03",
    amountCents: 4250,
    accountId,
    categoryId: food,
    description: "Supermercato",
    split,
    ...patch,
  });
  const docs = [
    tx({ payeeId, payerMemberId: ownerId }),
    tx({ description: "Mercato", amountCents: 1000, date: "2026-09-12" }),
    tx({
      type: "income",
      categoryId: income,
      description: "Stipendio",
      amountCents: 250000,
      date: "2026-10-27",
    }),
    ...Array.from({ length: extra }, (_, i) => tx({ description: `Extra ${i}`, amountCents: 100 })),
  ];
  for (const doc of docs) await adapter.put(familyId, "transactions", doc);
  return { adapter, familyId, docs };
}

const registerTable = () => screen.findByRole("table", { name: "Registro dei movimenti" });
const rowOf = (table: HTMLElement, text: string) => within(table).getAllByText(text)[0]!.closest("tr")!;

describe("registro movimenti", () => {
  it("mostra il periodo con totali e tabelle riassuntive che tornano, senza violazioni axe", async () => {
    const user = userEvent.setup();
    const { adapter } = await seeded();
    renderApp(adapter, "/movimenti?periodo=tutto");
    const table = await registerTable();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    const totals = screen.getByRole("region", { name: "Totali del periodo" });
    expect(totals.textContent).toContain("+2.500,00");
    expect(totals.textContent).toContain("−52,50");
    expect(totals.textContent).toContain("2.447,50");

    await user.click(screen.getByRole("tab", { name: "Categoria" }));
    const byCategory = screen.getByRole("table", { name: "Totali per categoria" });
    const foot = byCategory.querySelector("tfoot")!;
    expect(foot.textContent).toContain("3");
    expect(foot.textContent).toContain("2.447,50");
    expect(within(byCategory).getByText("Spesa Alimentare").closest("tr")!.textContent).toContain("52,50");

    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("i filtri vengono dall'URL e lo aggiornano; i chip si tolgono", async () => {
    const user = userEvent.setup();
    const { adapter } = await seeded();
    const router = renderApp(adapter, "/movimenti?periodo=tutto&tipo=entrate");
    const table = await registerTable();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(rowOf(table, "Stipendio").textContent).toContain("+2.500,00");

    await user.click(screen.getByRole("button", { name: "Rimuovi filtro Tipo: Entrata" }));
    expect(router.state.location.search).toBe("?periodo=tutto");

    await user.type(screen.getByRole("searchbox", { name: "Cerca nel testo" }), "coop");
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("coop");
    const filtered = await registerTable();
    expect(within(filtered).getAllByRole("row")).toHaveLength(2);
    expect(within(filtered).getByText("Supermercato")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(router.state.location.search).toBe("");
  });

  it("un periodo senza movimenti ha il suo stato vuoto", async () => {
    const { adapter } = await seeded();
    renderApp(adapter, "/movimenti?periodo=personalizzato&dal=2020-01-01&al=2020-01-31");
    expect(await screen.findByText("Nessun movimento con questi filtri")).toBeTruthy();
  });

  it("un errore del backend mostra Riprova", async () => {
    const { adapter } = await seeded();
    const failing: DataAdapter = {
      ...adapter,
      list: (familyId, collection, query) =>
        collection === "transactions"
          ? Promise.resolve(err({ code: "not_found" as const }))
          : adapter.list(familyId, collection, query),
    };
    renderApp(failing, "/movimenti?periodo=tutto");
    expect(await screen.findByRole("button", { name: "Riprova" })).toBeTruthy();
  });

  it("pagine da 50 righe, con la pagina nell'URL", async () => {
    const user = userEvent.setup();
    const { adapter } = await seeded(50);
    const router = renderApp(adapter, "/movimenti?periodo=tutto");
    expect(await screen.findByText("Pagina 1 di 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pagina successiva" }));
    expect(router.state.location.search).toBe("?periodo=tutto&pagina=2");
    expect(await screen.findByText("Pagina 2 di 2")).toBeTruthy();
    expect(within(await registerTable()).getAllByRole("row")).toHaveLength(4);
  });

  it("modifica dal menu della riga e torna al registro con gli stessi filtri", async () => {
    const user = userEvent.setup();
    const { adapter, familyId, docs } = await seeded();
    const router = renderApp(adapter, "/movimenti?periodo=tutto&tipo=spese");
    const table = await registerTable();
    await user.click(within(rowOf(table, "Mercato")).getByRole("button", { name: /Azioni sul movimento/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Modifica" }));

    expect(await screen.findByRole("heading", { name: "Modifica movimento" })).toBeTruthy();
    const description = screen.getByLabelText("Descrizione");
    expect((description as HTMLInputElement).value).toBe("Mercato");
    await user.clear(description);
    await user.type(description, "Mercato rionale");
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));

    expect(await screen.findByText("Movimento aggiornato.")).toBeTruthy();
    expect(router.state.location.search).toBe("?periodo=tutto&tipo=spese");
    expect((await screen.findAllByText("Mercato rionale")).length).toBeGreaterThan(0);
    const saved = await adapter.get(familyId, "transactions", docs[1]!.id);
    expect(saved.ok && saved.value.description).toBe("Mercato rionale");
  });

  it("elimina dopo la conferma; il movimento sparisce dal registro e dal backend", async () => {
    const user = userEvent.setup();
    const { adapter, familyId, docs } = await seeded();
    renderApp(adapter, "/movimenti?periodo=tutto");
    const table = await registerTable();
    await user.click(within(rowOf(table, "Mercato")).getByRole("button", { name: /Azioni sul movimento/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Elimina" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Elimina" }));

    expect(await screen.findByText("Movimento eliminato.")).toBeTruthy();
    expect((await adapter.get(familyId, "transactions", docs[1]!.id)).ok).toBe(false);
    const after = await registerTable();
    await expect.poll(() => within(after).queryByText("Mercato")).toBeNull();
  });

  it("un movimento inesistente mostra il suo stato", async () => {
    const { adapter } = await seeded();
    renderApp(adapter, `/movimenti/${newId()}`);
    expect(await screen.findByText("Movimento non trovato")).toBeTruthy();
  });
});
