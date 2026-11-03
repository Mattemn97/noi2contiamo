// Dashboard nel DOM (feature 14-16): i numeri cambiano passando da vista di coppia a personale.
import { defaultCategories, newId } from "@noi2contiamo/core";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../../data/AdapterContext";
import { createQueryClient } from "../../queryClient";
import { routes } from "../../routes";
import { UiProvider } from "../../ui";

describe("dashboard", () => {
  it("la vista personale mostra solo la quota dell'utente", async () => {
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
    const invite = await adapter.membership.createInvite(familyId, { id: newId() });
    if (!invite.ok) throw new Error("invito");
    await adapter.auth.signUp("bruno@example.com", "password-di-prova");
    await adapter.membership.acceptInvite(invite.value.token, "Bruno");
    await adapter.auth.signIn("anna@example.com", "password-di-prova");
    const listed = await adapter.list(familyId, "members");
    const partnerId = listed.ok ? listed.value.docs.find((m) => m.displayName === "Bruno")!.id : "";
    const accountId = newId();
    await adapter.put(familyId, "accounts", {
      id: accountId,
      name: "Cassa",
      kind: "checking",
      ownerMemberId: null,
      initialBalanceDate: "2026-01-01",
    });
    const put = await adapter.put(familyId, "transactions", {
      id: newId(),
      type: "expense",
      date: new Date().toISOString().slice(0, 10),
      amountCents: 10000,
      description: "Spesa",
      accountId,
      payerMemberId: ownerId,
      categoryId: categories.find((c) => c.kind === "expense")!.id,
      split: { kind: "bp", source: "manual", shares: { [ownerId]: 3000, [partnerId]: 7000 } },
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    render(
      <UiProvider>
        <AdapterProvider adapter={adapter}>
          <QueryClientProvider client={createQueryClient()}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AdapterProvider>
      </UiProvider>,
    );
    expect(put.ok).toBe(true);
    expect((await screen.findAllByText("100,00 €")).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Personale" }));
    expect((await screen.findAllByText("30,00 €")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("100,00 €")).toHaveLength(0);
  });
});
