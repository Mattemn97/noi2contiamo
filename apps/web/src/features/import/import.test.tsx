// Procedura guidata di import nel DOM (spec 0006, AC-8, AC-9, AC-12, AC-16): file, colonne, anteprima,
// conferma, risultato; il secondo file della stessa banca salta le colonne; annullare l'import.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCategories, newId } from "@noi2contiamo/core";
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
import { profileDoc, suggestedName } from "./importWizard";

const PASSWORD = "password-di-prova";
const FIXTURES = join(import.meta.dirname, "../../../../../packages/core/src/import/fixtures");
const fixture = (name: string) => new File([readFileSync(join(FIXTURES, name))], name, { type: "text/csv" });

function renderApp(adapter: DataAdapter, path: string) {
  render(
    <UiProvider>
      <AdapterProvider adapter={adapter}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
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
  const accountId = newId();
  await adapter.put(familyId, "accounts", {
    id: accountId,
    name: "Intesa",
    kind: "checking",
    initialBalanceDate: "2026-01-01",
  });
  return { adapter, familyId, accountId };
}

async function list<C extends "transactions" | "importBatches" | "importProfiles">(
  adapter: DataAdapter,
  familyId: string,
  c: C,
) {
  const r = await adapter.list(familyId, c);
  if (!r.ok) throw new Error("lista");
  return r.value.docs;
}

async function chooseAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Conto/ }));
  await user.click(await screen.findByRole("option", { name: "Intesa" }));
}

describe("import CSV", () => {
  it("prima volta: colonne, anteprima, salva profilo, conferma; seconda volta zero doppioni e profilo riusato; annulla", async () => {
    const { adapter, familyId } = await seeded();
    const user = userEvent.setup();
    renderApp(adapter, "/importa");
    expect(await screen.findByRole("heading", { name: "Importa movimenti" })).toBeTruthy();
    expect(screen.getByText("Nessun import per ora.")).toBeTruthy();

    await chooseAccount(user);
    await user.upload(screen.getByLabelText("File CSV"), fixture("intesa.csv"));
    // Passo Colonne: proposte dal file (Windows-1252, 3 righe da saltare, Addebiti/Accrediti).
    expect(await screen.findByRole("heading", { name: "Colonne" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Righe da saltare/).value).toBe("3");
    expect(screen.getByText("COOP CAFFÈ CENTRALE MILANO")).toBeTruthy();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Avanti" }));

    // Anteprima con errori di riga.
    expect(await screen.findByText("8 nuovi, 0 doppioni, 0 giroconti, 2 con errori")).toBeTruthy();
    expect(screen.getByText("Data non valida: «31/02/2026»")).toBeTruthy();
    expect(screen.getByText("Né Dare né Avere")).toBeTruthy();
    const name = screen.getByLabelText(/Nome del profilo/);
    await user.clear(name);
    await user.type(name, "Intesa Sanpaolo");
    await user.click(screen.getByRole("button", { name: "Importa 8 movimenti" }));
    await user.click(await screen.findByRole("button", { name: "Importa" }));
    expect(
      await screen.findByText("Salvati 8 movimenti, 0 doppioni saltati, 2 righe con errori."),
    ).toBeTruthy();
    expect(await list(adapter, familyId, "transactions")).toHaveLength(8);
    const [profile] = await list(adapter, familyId, "importProfiles");
    expect(profile?.name).toBe("Intesa Sanpaolo");

    // Secondo file della stessa banca: profilo riconosciuto, niente colonne, tutto doppione.
    await user.click(screen.getByRole("button", { name: "Importa un altro file" }));
    await user.upload(await screen.findByLabelText("File CSV"), fixture("intesa.csv"));
    expect(
      await screen.findByText("Profilo «Intesa Sanpaolo» riconosciuto: le colonne sono già mappate."),
    ).toBeTruthy();
    expect(await screen.findByText("0 nuovi, 8 doppioni, 0 giroconti, 2 con errori")).toBeTruthy();
    expect(screen.getByText(/Hai già importato questo file/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Importa 0 movimenti" }).disabled).toBe(
      true,
    );

    // Storico e annullamento.
    await user.click(screen.getByRole("button", { name: "Indietro" }));
    await user.click(screen.getByRole("button", { name: "Indietro" }));
    await user.click(await screen.findByRole("button", { name: "Annulla import" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Annulla import" }));
    await waitFor(async () => {
      expect(await list(adapter, familyId, "importBatches")).toEqual([]);
    });
    expect(await list(adapter, familyId, "transactions")).toEqual([]);
    expect(await screen.findByText("Nessun import per ora.")).toBeTruthy();
  });

  it("il salvataggio mostra una barra che avanza a gruppi fino alla fine", async () => {
    const { adapter, familyId } = await seeded();
    // I salvataggi aspettano un via libera, così si vede la barra tra un gruppo e l'altro.
    const gates: (() => void)[] = [];
    const slow: DataAdapter = {
      ...adapter,
      commit: (f, ops) =>
        new Promise<void>((resolve) => gates.push(resolve)).then(() => adapter.commit(f, ops)),
    };
    const user = userEvent.setup();
    renderApp(slow, "/importa");
    await chooseAccount(user);
    const rows = Array.from(
      { length: 45 },
      (_, i) => `${String((i % 28) + 1).padStart(2, "0")}/10/2026;Spesa ${i};-${i + 1},00`,
    );
    const csv = new File([["Data;Descrizione;Importo", ...rows].join("\n")], "grande.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText("File CSV"), csv);
    await user.click(await screen.findByRole("button", { name: "Avanti" }));
    await user.click(await screen.findByRole("button", { name: "Importa 45 movimenti" }));
    await user.click(await screen.findByRole("button", { name: "Importa" }));

    const bar = await screen.findByRole("progressbar", { name: "Salvataggio in corso" });
    const total = Number(/di (\d+)/.exec(bar.getAttribute("aria-valuetext") ?? "")?.[1]);
    expect(total).toBeGreaterThanOrEqual(46);
    expect(bar.getAttribute("aria-valuetext")).toBe(`0 di ${total}`);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Annulla" }).disabled).toBe(true);

    await waitFor(() => {
      expect(gates).toHaveLength(1);
    });
    gates.shift()!();
    await waitFor(() => {
      expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(`20 di ${total}`);
    });
    while (!screen.queryByText(/Salvati 45 movimenti/)) {
      await waitFor(() => {
        expect(gates.length > 0 || screen.queryByText(/Salvati 45 movimenti/) !== null).toBe(true);
      });
      gates.shift()?.();
    }
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(await list(adapter, familyId, "transactions")).toHaveLength(45);
  });

  it("senza conto il file non si legge", async () => {
    const { adapter } = await seeded();
    const user = userEvent.setup();
    renderApp(adapter, "/importa");
    await user.upload(await screen.findByLabelText("File CSV"), fixture("satispay.csv"));
    expect((await screen.findByRole("alert")).textContent).toBe("Scegli prima il conto.");
  });

  it("aiuti: nome proposto e profilo con le colonne per nome", () => {
    expect(suggestedName("movimenti_intesa_2026-10.csv")).toBe("movimenti intesa");
    expect(suggestedName("2026.csv")).toBe("Profilo");
    const bytes = new TextEncoder().encode("Data;Descrizione;Importo\n01/10/2026;Bar;-1,50\n");
    const doc = profileDoc({
      id: newId(),
      name: "  Banca  ",
      accountId: newId(),
      bytes,
      settings: {
        encoding: "utf-8",
        delimiter: ";",
        quote: '"',
        skipRows: 0,
        hasHeader: true,
        columns: { date: { index: 0 }, description: [{ index: 1 }], amount: { index: 2 } },
        dateFormat: "dd/MM/yyyy",
        decimalSeparator: ",",
        thousandsSeparator: "",
        sign: { mode: "negativeIsExpense" },
      },
    });
    expect(doc.name).toBe("Banca");
    expect(doc.columns).toEqual({
      date: { header: "Data" },
      description: [{ header: "Descrizione" }],
      amount: { header: "Importo" },
    });
    expect(doc.headerSignature).toMatch(/^[0-9a-f]{32}$/);
  });
});
