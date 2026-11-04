// Inviti nel DOM, sull'adapter memory: il partner entra dal link, la pagina famiglia mostra membri e inviti.
import { newId } from "@noi2contiamo/core";
import type { DataAdapter } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

async function familyWithInvite(expiresAtMs?: number) {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", PASSWORD);
  const familyId = newId();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa Rossi" },
    ownerMember: { id: newId(), displayName: "Anna" },
  });
  const invite = await adapter.membership.createInvite(familyId, {
    id: newId(),
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
  });
  if (!invite.ok) throw new Error("invito non creato");
  return { adapter, familyId, token: invite.value.token };
}

describe("inviti", () => {
  it("il partner apre il link, si registra, entra e vede la famiglia", async () => {
    const user = userEvent.setup();
    const { adapter, token } = await familyWithInvite();
    await adapter.auth.signOut();
    const router = renderApp(adapter, `/invito/${token}`);

    expect(await screen.findByRole("heading", { name: "Accedi" })).toBeTruthy();
    // Il link a "Registrati" porta con sé la pagina di ritorno (in jsdom si segue a mano).
    const toRegister = screen.getByRole("link", { name: /Registrati/ }).getAttribute("href") ?? "";
    expect(toRegister).toBe(`/registrati?da=${encodeURIComponent(`/invito/${token}`)}`);
    await router.navigate(toRegister);
    await user.type(await screen.findByLabelText(/Email/), "bruno@example.com");
    await user.type(screen.getByLabelText(/Password/), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Registrati" }));

    expect(await screen.findByRole("heading", { name: "Entra nella famiglia" })).toBeTruthy();
    await user.type(screen.getByLabelText(/Come ti chiamano/), "Bruno");
    await user.click(screen.getByRole("button", { name: "Entra nella famiglia" }));
    expect(await screen.findByText("Famiglia Casa Rossi")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
  });

  it("un invito scaduto mostra il motivo e non fa entrare", async () => {
    const user = userEvent.setup();
    const { adapter, token } = await familyWithInvite(1);
    await adapter.auth.signUp("bruno@example.com", PASSWORD);
    renderApp(adapter, "/benvenuto");
    await user.type(await screen.findByLabelText(/Codice di invito/), token);
    await user.type(screen.getByLabelText(/Come ti chiamano/), "Bruno");
    await user.click(screen.getByRole("button", { name: "Entra nella famiglia" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "L'invito è scaduto. Chiedi un nuovo invito.",
    );
    const families = await adapter.membership.myFamilies();
    expect(families.ok && families.value).toEqual([]);
  });

  it("la pagina famiglia mostra membri e inviti in attesa, e crea un invito con link, senza violazioni axe", async () => {
    const user = userEvent.setup();
    const { adapter } = await familyWithInvite();
    renderApp(adapter, "/altro/famiglia");
    expect(await screen.findByRole("heading", { name: "Famiglia" })).toBeTruthy();
    expect(screen.getByText("Anna")).toBeTruthy();
    expect(screen.getAllByText(/Scade il/)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Crea invito" }));
    const link = await screen.findByLabelText<HTMLInputElement>(/Link da mandare/);
    expect(link.value).toMatch(/\/invito\/[a-z2-7]{26}$/);
    expect(await screen.findAllByText(/Scade il/)).toHaveLength(2);
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("l'ultimo proprietario che prova a uscire riceve un messaggio chiaro", async () => {
    const user = userEvent.setup();
    const { adapter } = await familyWithInvite();
    renderApp(adapter, "/altro/famiglia");
    await user.click(await screen.findByRole("button", { name: "Esci dalla famiglia" }));
    await user.click(await screen.findByRole("button", { name: "Esci" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Serve almeno un proprietario nella famiglia.",
    );
  });
});
