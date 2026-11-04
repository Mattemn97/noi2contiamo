// Il filo base nel DOM, sull'adapter memory: registrazione, famiglia, movimento, registro, uscita.
import { defaultCategories, newId } from "@noi2contiamo/core";
import type { DataAdapter } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../data/AdapterContext";
import { createQueryClient } from "../queryClient";
import { routes } from "../routes";
import { UiProvider } from "../ui";

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
    initialBalanceDate: "2026-01-01",
  });
  await adapter.put(familyId, "transactions", {
    id: newId(),
    type: "expense",
    date: "2026-11-03",
    amountCents: 4250,
    accountId,
    categoryId: categories.find((c) => c.name === "Spesa Alimentare")!.id,
    description: "Supermercato",
    split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
  });
  return adapter;
}

describe("filo base", () => {
  it("senza sessione le pagine dei dati portano all'accesso", async () => {
    const router = renderApp(createMemoryAdapter(), "/movimenti");
    expect(await screen.findByRole("heading", { name: "Accedi" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/accedi");
  });

  it("credenziali sbagliate: un messaggio in italiano", async () => {
    const user = userEvent.setup();
    const adapter = createMemoryAdapter();
    await adapter.auth.signUp("anna@example.com", "password-di-prova");
    await adapter.auth.signOut();
    renderApp(adapter, "/accedi");
    await user.type(await screen.findByLabelText(/Email/), "anna@example.com");
    await user.type(screen.getByLabelText(/Password/), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email o password non corretti.");
  });

  it("registrazione, poi la famiglia con conto e categorie, poi il nuovo movimento", async () => {
    const user = userEvent.setup();
    const adapter = createMemoryAdapter();
    const router = renderApp(adapter, "/registrati");
    await user.type(await screen.findByLabelText(/Email/), "nuovo@example.com");
    await user.type(screen.getByLabelText(/Password/), "password-di-prova");
    await user.click(screen.getByRole("button", { name: "Registrati" }));

    expect(await screen.findByRole("heading", { name: "Crea la tua famiglia" })).toBeTruthy();
    await user.type(screen.getByLabelText(/Nome della famiglia/), "Casa Bianchi");
    await user.type(screen.getByLabelText(/Il tuo nome/), "Bruno");
    await user.click(screen.getByRole("button", { name: "Crea la famiglia" }));

    expect(await screen.findByRole("heading", { name: "Nuovo movimento" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/movimenti/nuovo");
    const families = await adapter.membership.myFamilies();
    const familyId = families.ok ? families.value[0]!.family.id : "";
    const accounts = await adapter.list(familyId, "accounts");
    const categories = await adapter.list(familyId, "categories");
    expect(accounts.ok && accounts.value.docs.map((a) => a.name)).toEqual(["Conto comune"]);
    expect(categories.ok && categories.value.docs).toHaveLength(9);

    // Salvare senza importo né categoria mostra cosa manca, senza scrivere niente.
    await user.click(screen.getByRole("button", { name: "Salva movimento" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Scrivi un importo maggiore di zero.");
    expect(alert.textContent).toContain("Scegli una categoria.");
  });

  it("il registro mostra il movimento con importo, categoria e conto, senza violazioni axe", async () => {
    renderApp(await seeded(), "/movimenti?periodo=tutto");
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Supermercato").closest("tr")!;
    expect(row.textContent).toContain("Spesa Alimentare");
    expect(row.textContent).toContain("Conto comune");
    expect(row.textContent).toContain("42,50");
    expect(row.textContent).toContain("3 novembre 2026");
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("esci chiude la sessione e torna all'accesso", async () => {
    const user = userEvent.setup();
    const adapter = await seeded();
    const router = renderApp(adapter, "/altro");
    await user.click(await screen.findByRole("button", { name: "Esci" }));
    expect(await screen.findByRole("heading", { name: "Accedi" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/accedi");
    expect(await adapter.auth.currentUser()).toBeNull();
  });
});
