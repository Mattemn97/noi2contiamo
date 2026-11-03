// Promemoria nel DOM (adapter memory): elenco con numero, archiviazione, impostazioni.
import { defaultCategories, newId } from "@noi2contiamo/core";
import type { WriteDocOf } from "@noi2contiamo/data";
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
import { todayIso } from "../recurring/useRecurring";

async function seeded() {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", "password-di-prova");
  const familyId = newId();
  const ownerId = newId();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa Rossi" },
    ownerMember: { id: ownerId, displayName: "Anna" },
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
  return { adapter, familyId, ownerId };
}

function renderApp(adapter: Awaited<ReturnType<typeof seeded>>["adapter"], path: string) {
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
}

describe("promemoria", () => {
  it("mostra la scadenza di oggi con il numero accanto ad Altro e la archivia", async () => {
    const { adapter, familyId } = await seeded();
    renderApp(adapter, "/promemoria");
    expect(await screen.findByText(/Affitto scade oggi/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Altro\s*1/ })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Fatto" }));
    expect(await screen.findByText("Nessun promemoria")).toBeTruthy();
    const stored = await adapter.list(familyId, "reminders");
    expect(stored.ok && stored.value.docs.map((d) => d.status)).toEqual(["dismissed"]);
  });

  it("le impostazioni si salvano e spegnere il tipo toglie i promemoria", async () => {
    const { adapter, familyId, ownerId } = await seeded();
    renderApp(adapter, "/altro/promemoria");
    expect(await screen.findByText(/solo l'elenco nell'app/)).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Scadenze dei pagamenti ricorrenti" }));
    await waitFor(async () => {
      const got = await adapter.get(familyId, "memberSettings", ownerId);
      expect(got.ok && got.value.notifications.recurringDue.enabled).toBe(false);
    });
  });
});
