// Divisione spese nel DOM (spec 0004): editor nel movimento, divisione della famiglia, registro, riapplica.
import { defaultCategories, equalSplit, newId } from "@noi2contiamo/core";
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
import { amountsText, remainderText, splitText } from "./SplitEditor";

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

/** Anna (proprietaria) e Bruno (entrato con invito), un conto comune e una spesa di 100,01 €. */
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
  const accountId = newId();
  await adapter.put(familyId, "accounts", {
    id: accountId,
    name: "Conto comune",
    kind: "checking",
    initialBalanceDate: "2026-01-01",
  });
  const txId = newId();
  await adapter.put(familyId, "transactions", {
    id: txId,
    type: "expense",
    date: "2026-11-03",
    amountCents: 10001,
    description: "Bolletta",
    accountId,
    categoryId: categories.find((c) => c.name === "Spesa Alimentare")!.id,
    split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
  });
  return { adapter, familyId, ownerId, partnerId, txId };
}

async function txOf(adapter: DataAdapter, familyId: string, id: string) {
  const got = await adapter.get(familyId, "transactions", id);
  if (!got.ok) throw new Error("movimento");
  return got.value;
}

describe("testi della divisione", () => {
  const names = (id: string) => (id === "a" ? "Anna" : "Bruno");

  it("importi per membro al centesimo e quanto manca o avanza (AC-3)", () => {
    expect(amountsText(10001, { kind: "bp", shares: { a: 6000, b: 4000 } }, names)).toBe(
      "Anna 60,01 € · Bruno 40,00 €",
    );
    expect(remainderText({ kind: "bp", shares: { a: 6000, b: 3000 } }, 100)).toBe("Mancano 10%");
    expect(remainderText({ kind: "cents", shares: { a: 60, b: 50 } }, 100)).toMatch(/^Avanzano 0,10/);
    expect(remainderText({ kind: "cents", shares: { a: 60, b: 40 } }, 100)).toBeNull();
  });

  it("nel registro: 'a mano' solo per le divisioni manuali (AC-9)", () => {
    expect(
      splitText(
        { amountCents: 1, split: { kind: "bp", source: "default", shares: { a: 5000, b: 5000 } } },
        names,
      ),
    ).toBe("Anna 0,01 € · Bruno 0,00 €");
    expect(
      splitText(
        { amountCents: 300, split: { kind: "cents", source: "manual", shares: { a: 100, b: 200 } } },
        names,
      ),
    ).toBe("Anna 1,00 € · Bruno 2,00 € (a mano)");
    expect(splitText({ amountCents: 300, split: null }, names)).toBe("");
  });
});

describe("editor nel movimento (AC-4)", () => {
  it("divide a mano 50/50, passa a importo e salva le quote in centesimi", async () => {
    const user = userEvent.setup();
    const { adapter, familyId, ownerId, partnerId, txId } = await seeded();
    renderApp(adapter, `/movimenti/${txId}`);
    expect(await screen.findByText(/In automatico: divisione della famiglia\./)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dividi a mano" }));
    await user.click(screen.getByRole("button", { name: "50/50" }));
    expect(await screen.findByText(/Anna 50,01.*Bruno 50,00/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Importo" }));
    expect(screen.getByLabelText<HTMLInputElement>("Quota di Bruno").value).toBe("50,00");

    const bruno = screen.getByLabelText("Quota di Bruno");
    await user.clear(bruno);
    await user.type(bruno, "40");
    expect(await screen.findByText(/^Mancano 10,00/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    expect((await screen.findAllByText(/Le quote della divisione devono fare/)).length).toBeGreaterThan(0);

    await user.clear(bruno);
    await user.type(bruno, "50");
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    await waitFor(async () => {
      expect((await txOf(adapter, familyId, txId)).split).toEqual({
        kind: "cents",
        source: "manual",
        shares: { [ownerId]: 5001, [partnerId]: 5000 },
      });
    });
  });

  it("non ha violazioni axe con l'editor aperto", async () => {
    const user = userEvent.setup();
    const { adapter, txId } = await seeded();
    renderApp(adapter, `/movimenti/${txId}`);
    await user.click(await screen.findByRole("button", { name: "Dividi a mano" }));
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("divisione della famiglia e riapplica (AC-6, AC-7)", () => {
  it("salva 50/50 e la riapplica ai movimenti automatici", async () => {
    const user = userEvent.setup();
    const { adapter, familyId, ownerId, partnerId, txId } = await seeded();
    renderApp(adapter, "/altro/famiglia");
    const card = (await screen.findByRole("heading", { name: "Divisione predefinita" })).closest("section")!;
    await user.click(within(card).getByRole("button", { name: "50/50" }));
    await user.click(within(card).getByRole("button", { name: "Salva divisione" }));
    await waitFor(async () => {
      const families = await adapter.membership.myFamilies();
      expect(families.ok && families.value[0]?.family.defaultSplit).toEqual(equalSplit([ownerId, partnerId]));
    });
    expect((await txOf(adapter, familyId, txId)).split?.shares).toEqual({ [ownerId]: 10000 });

    await user.click(within(card).getByRole("button", { name: "Riapplica ai movimenti" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Cambiano 1 movimenti");
    await user.click(within(dialog).getByRole("button", { name: "Riapplica" }));
    await waitFor(async () => {
      expect((await txOf(adapter, familyId, txId)).split?.shares).toEqual({
        [ownerId]: 5000,
        [partnerId]: 5000,
      });
    });
  });

  it("rifiuta quote che non fanno 100%", async () => {
    const user = userEvent.setup();
    const { adapter } = await seeded();
    renderApp(adapter, "/altro/famiglia");
    const card = (await screen.findByRole("heading", { name: "Divisione predefinita" })).closest("section")!;
    const anna = within(card).getByLabelText("Quota di Anna");
    await user.clear(anna);
    await user.type(anna, "60");
    await user.click(within(card).getByRole("button", { name: "Salva divisione" }));
    expect(await within(card).findByRole("alert")).toBeTruthy();
  });
});

describe("registro (AC-9)", () => {
  it("mostra la divisione per membro", async () => {
    const { adapter } = await seeded();
    renderApp(adapter, "/movimenti?periodo=tutto");
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Bolletta").closest("tr")!;
    expect(row.textContent).toContain("Anna 100,01");
  });
});
