// Import dal conto bancario (feature 24) nel DOM, con un backend finto: stati, collegamento, anteprima.
import { defaultCategories, newId } from "@noi2contiamo/core";
import type { DataAdapter } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AdapterProvider } from "../../data/AdapterContext";
import { createQueryClient } from "../../queryClient";
import { routes } from "../../routes";
import { UiProvider } from "../../ui";
import { createBankApi } from "./bankApi";
import { BankApiProvider } from "./bankApiContext";

const PASSWORD = "password-di-prova";

const CONNECTION = {
  id: "conn-1",
  bankName: "Banca Prova",
  country: "IT",
  validUntil: "2099-01-01T00:00:00+00:00",
  accounts: [{ uid: "acc-1", iban: "IT60X0542811101000000123456", name: "Conto corrente", currency: "EUR" }],
};

const TRANSACTIONS = [
  {
    entry_reference: "1",
    transaction_amount: { currency: "EUR", amount: "42.50" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-11-03",
    remittance_information: ["Spesa settimanale"],
    creditor: { name: "Supermercato Rossi" },
  },
  {
    entry_reference: "2",
    transaction_amount: { currency: "EUR", amount: "1234.56" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    booking_date: "2026-11-02",
    remittance_information: ["Stipendio"],
    debtor: { name: "Azienda Srl" },
  },
  {
    entry_reference: "3",
    transaction_amount: { currency: "EUR", amount: "9.99" },
    credit_debit_indicator: "DBIT",
    status: "PDNG",
    booking_date: "2026-11-04",
  },
];

function fakeFetch(handler: (url: URL, init: RequestInit | undefined) => unknown): typeof fetch {
  return (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost",
    );
    const body = handler(url, init);
    if (body === undefined) return Promise.resolve(new Response("<html></html>", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
}

function renderApp(adapter: DataAdapter, path: string, fetchImpl: typeof fetch) {
  const api = createBankApi({ baseUrl: "/api/bank/", headers: () => Promise.resolve({}), fetch: fetchImpl });
  render(
    <UiProvider>
      <AdapterProvider adapter={adapter}>
        <QueryClientProvider client={createQueryClient()}>
          <BankApiProvider api={api} redirect={() => undefined}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
          </BankApiProvider>
        </QueryClientProvider>
      </AdapterProvider>
    </UiProvider>,
  );
}

async function seeded() {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", PASSWORD);
  const familyId = newId();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa Rossi" },
    ownerMember: { id: newId(), displayName: "Anna" },
    defaults: { categories: defaultCategories() },
  });
  await adapter.put(familyId, "accounts", {
    id: newId(),
    name: "Intesa",
    kind: "checking",
    initialBalanceDate: "2026-01-01",
  });
  return { adapter, familyId };
}

describe("import dal conto bancario", () => {
  it("senza backend spiega le alternative (Blaze o npm run bank:csv)", async () => {
    const { adapter } = await seeded();
    const user = userEvent.setup();
    renderApp(
      adapter,
      "/importa",
      fakeFetch(() => undefined),
    );
    await user.click(await screen.findByRole("radio", { name: "Dal conto bancario" }));
    expect(
      await screen.findByRole("heading", { name: "Connessione alla banca non disponibile" }),
    ).toBeTruthy();
    expect(screen.getByText(/npm run bank:csv/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /guida/ }).getAttribute("href")).toContain(
      "guida-open-banking.md",
    );
  });

  it("proprietario: se non è configurato mostra il modulo e salva le credenziali", async () => {
    const { adapter } = await seeded();
    const user = userEvent.setup();
    let saved: unknown = null;
    let configured = false;
    renderApp(
      adapter,
      "/importa?fonte=banca",
      fakeFetch((url, init) => {
        if (url.pathname.endsWith("/status")) return { available: true, configured, canConfigure: true };
        if (url.pathname.endsWith("/config")) {
          saved = JSON.parse(init?.body as string);
          configured = true;
          return { configured: true };
        }
        if (url.pathname.endsWith("/connections")) return [];
        return undefined;
      }),
    );
    expect(await screen.findByRole("heading", { name: "Banca non ancora configurata" })).toBeTruthy();
    await user.type(screen.getByLabelText("App ID"), "app-1");
    await user.click(screen.getByLabelText(/Oppure incolla/));
    await user.paste("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    await user.click(screen.getByRole("button", { name: "Salva e verifica" }));
    expect(await screen.findByText("Nessuna banca collegata.")).toBeTruthy();
    expect(saved).toMatchObject({ appId: "app-1" });
  });

  it("configurato: scarica i movimenti e arriva all'anteprima con gli stessi passi del CSV", async () => {
    const { adapter, familyId } = await seeded();
    const user = userEvent.setup();
    renderApp(
      adapter,
      "/importa?fonte=banca",
      fakeFetch((url) => {
        if (url.pathname.endsWith("/status"))
          return { available: true, configured: true, canConfigure: false };
        if (url.pathname.endsWith("/connections")) return [CONNECTION];
        if (url.pathname.endsWith("/transactions")) {
          expect(url.searchParams.get("accountUid")).toBe("acc-1");
          return { transactions: TRANSACTIONS };
        }
        return undefined;
      }),
    );
    expect(await screen.findByText(/Banca Prova \(Italia\), consenso fino al/)).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Importa da qui" }));
    const download = screen.getByRole<HTMLButtonElement>("button", { name: "Scarica movimenti" });
    expect(download.disabled).toBe(true);
    await user.click(await screen.findByRole("button", { name: /Conto dell'app/ }));
    await user.click(await screen.findByRole("option", { name: "Intesa" }));
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Scarica movimenti" }).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByRole("button", { name: "Scarica movimenti" }));

    // Il movimento in sospeso (PDNG) non c'è: due nuovi.
    expect(await screen.findByText("2 nuovi, 0 doppioni, 0 giroconti, 0 con errori")).toBeTruthy();
    expect(screen.getByText("Spesa settimanale")).toBeTruthy();
    expect(screen.queryByLabelText(/Nome del profilo/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Importa 2 movimenti" }));
    await user.click(await screen.findByRole("button", { name: "Importa" }));
    expect(
      await screen.findByText("Salvati 2 movimenti, 0 doppioni saltati, 0 righe con errori."),
    ).toBeTruthy();

    const batches = await adapter.list(familyId, "importBatches");
    const docs = batches.ok ? batches.value.docs : [];
    expect(docs.map((b) => b.importedCount)).toEqual([2]);
    expect(docs[0]?.fileName).toMatch(
      /^Banca · Banca Prova · 3456 · \d{2}\/\d{2}\/\d{4}–\d{2}\/\d{2}\/\d{4}$/,
    );
  });

  it("ritorno dalla banca: crea la sessione e torna all'import", async () => {
    const { adapter } = await seeded();
    let posted: unknown = null;
    renderApp(
      adapter,
      "/importa/banca?code=abc&state=xyz",
      fakeFetch((url, init) => {
        if (url.pathname.endsWith("/sessions")) {
          posted = JSON.parse(init?.body as string);
          return CONNECTION;
        }
        if (url.pathname.endsWith("/status"))
          return { available: true, configured: true, canConfigure: false };
        if (url.pathname.endsWith("/connections")) return [CONNECTION];
        return undefined;
      }),
    );
    expect(await screen.findByText(/Banca Prova \(Italia\), consenso fino al/)).toBeTruthy();
    expect(posted).toMatchObject({ code: "abc", state: "xyz" });
  });

  it("ritorno con errore della banca: spiega e permette di tornare", async () => {
    const { adapter } = await seeded();
    renderApp(
      adapter,
      "/importa/banca?error=access_denied",
      fakeFetch(() => undefined),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Hai annullato l'autorizzazione alla banca.");
  });
});
