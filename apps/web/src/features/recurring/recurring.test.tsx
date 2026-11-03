// Ricorrenze nel DOM (adapter memory) e le funzioni pure del modulo (spec 0008).
import { defaultCategories, newId } from "@noi2contiamo/core";
import type { DataAdapter, WriteDocOf } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../../data/AdapterContext";
import { createQueryClient } from "../../queryClient";
import { routes } from "../../routes";
import { UiProvider } from "../../ui";
import { emptyForm, formIssues, frequencyLabel, presetOf, recurrenceOf } from "./recurringForm";
import { todayIso } from "./useRecurring";

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
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa Rossi" },
    ownerMember: { id: newId(), displayName: "Anna" },
    defaults: { categories: defaultCategories() },
  });
  const accountId = newId();
  await adapter.put(familyId, "accounts", {
    id: accountId,
    name: "Conto comune",
    kind: "checking",
    initialBalanceDate: "2020-01-01",
    initialBalanceCents: 100000,
  });
  const rent: WriteDocOf<"recurrences"> = {
    id: newId(),
    name: "Affitto",
    type: "expense",
    accountId,
    expectedAmountCents: 70000,
    amountToleranceBp: 0,
    frequency: { unit: "month", interval: 1 },
    startDate: todayIso(),
  };
  await adapter.put(familyId, "recurrences", rent);
  return { adapter, familyId, accountId, rent };
}

describe("funzioni del modulo", () => {
  it("riconosce le frequenze, le scrive in italiano e valida il modulo", () => {
    expect(presetOf({ unit: "month", interval: 3 })).toBe("quarter");
    expect(presetOf({ unit: "day", interval: 10 })).toBe("custom");
    expect(frequencyLabel({ unit: "month", interval: 1 })).toBe("Ogni mese");
    expect(frequencyLabel({ unit: "week", interval: 2 })).toBe("Ogni 2 settimane");
    const ctx = { accounts: [], categories: [], payees: [], activeMemberIds: new Set<string>() };
    const form = emptyForm("2026-11-03", null);
    expect(formIssues(form, newId(), ctx)).toEqual([
      "Scrivi un nome.",
      "Scrivi un importo maggiore di zero.",
      "Scegli il conto.",
    ]);
    expect(
      recurrenceOf({ ...form, name: " Affitto ", dayOfMonth: "31", count: "3" }, "x", null).frequency,
    ).toEqual({
      unit: "month",
      interval: 1,
      dayOfMonth: 31,
      count: 3,
    });
  });
});

describe("pagina Ricorrenti", () => {
  it("mostra la scadenza in arrivo e registra il pagamento già collegato", async () => {
    const user = userEvent.setup();
    const s = await seeded();
    renderApp(s.adapter, "/ricorrenti");
    expect(await screen.findAllByText("Affitto")).not.toHaveLength(0);
    await user.click((await screen.findAllByRole("button", { name: /Registra pagamento: Affitto/ }))[0]!);
    await waitFor(async () => {
      const r = await s.adapter.list(s.familyId, "transactions");
      if (!r.ok) throw new Error("lettura");
      expect(r.value.docs).toHaveLength(1);
      expect(r.value.docs[0]).toMatchObject({
        recurrenceId: s.rent.id,
        recurrenceDueDate: todayIso(),
        amountCents: 70000,
      });
    });
    expect(await screen.findByText("Pagata")).toBeTruthy();
  });
});

describe("pagina Previsioni", () => {
  it("mostra la tabella mensile con il saldo e le scadenze aperte", async () => {
    const s = await seeded();
    renderApp(s.adapter, "/previsioni");
    expect(await screen.findByRole("table", { name: "Previsione mese per mese" })).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(6);
  });
});
