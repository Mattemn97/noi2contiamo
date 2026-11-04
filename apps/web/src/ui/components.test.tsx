// AC-5 (tastiera), AC-6 (navigazione), AC-7 (ChartFrame), AC-8 (MoneyField): i componenti di ui/ nel DOM.
import { cents, type Cents } from "@noi2contiamo/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Line, LineChart, YAxis } from "recharts";
import { describe, expect, it, vi } from "vitest";
import {
  AppShell,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  FilterBar,
  MoneyField,
  ThemeSwitcher,
  UiProvider,
  useToast,
  type DataTableColumn,
} from ".";
import { ChartFrame } from "./charts";
import { TOAST_DURATION_MS } from "./Toast/Toast";

describe("Button", () => {
  it("si attiva con Invio e Spazio", async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Salva</Button>);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Salva" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe("MoneyField (AC-8)", () => {
  function Harness({ onValue }: { readonly onValue: (value: Cents | null) => void }) {
    return (
      <UiProvider>
        <MoneyField label="Importo" onChange={onValue} />
      </UiProvider>
    );
  }

  it.each([
    ["12,5", 1250],
    ["1.234,56", 123456],
  ])("%s → %i centesimi", async (text, expected) => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(screen.getByLabelText("Importo"), text);
    expect(onValue).toHaveBeenLastCalledWith(expected);
  });

  it("chiede la tastiera decimale e mostra l'errore dopo l'uscita dal campo", async () => {
    const user = userEvent.setup();
    render(<Harness onValue={() => undefined} />);
    const input = screen.getByLabelText("Importo");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    await user.type(input, "12,345");
    await user.tab();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Al massimo due decimali.")).toBeTruthy();
  });

  it("riformatta il valore in it-IT all'uscita", async () => {
    const user = userEvent.setup();
    render(<Harness onValue={() => undefined} />);
    const input = screen.getByLabelText<HTMLInputElement>("Importo");
    await user.type(input, "1234,5");
    await user.tab();
    expect(input.value).toBe("1.234,50");
  });
});

describe("Dialog e ConfirmDialog (AC-5)", () => {
  it("si apre dal bottone, Esc chiude e il focus torna al bottone", async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="Nuovo movimento" trigger={<Button>Apri</Button>}>
        <p>Corpo</p>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Apri" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Nuovo movimento" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("ConfirmDialog è un alertdialog e conferma solo con l'azione", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Eliminare?"
        message="Non si torna indietro."
        trigger={<Button variant="danger">Elimina movimento</Button>}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Elimina movimento" }));
    const dialog = screen.getByRole("alertdialog", { name: "Eliminare?" });
    await user.click(within(dialog).getByRole("button", { name: "Annulla" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Elimina movimento" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Elimina" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <Button
        onPress={() => {
          toast.show({
            message: "Movimento salvato.",
            action: { label: "Annulla", onAction: () => undefined },
          });
        }}
      >
        Mostra
      </Button>
    );
  }

  it("annuncia in una regione polite e sparisce dopo 5 secondi", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      render(
        <UiProvider>
          <Trigger />
        </UiProvider>,
      );
      await user.click(screen.getByRole("button", { name: "Mostra" }));
      const region = screen.getByRole("region", { name: "Notifiche" });
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(within(region).getByText("Movimento salvato.")).toBeTruthy();
      expect(within(region).getByRole("button", { name: "Annulla" })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS);
      });
      expect(within(region).queryByText("Movimento salvato.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ThemeSwitcher (AC-2)", () => {
  it("cambia subito il tema e ricorda la scelta", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);
    const dark = screen.getByRole("radio", { name: "Scuro" });
    await user.click(dark);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("n2c.theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: "Sistema" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("AppShell (AC-6)", () => {
  it("ha il salto al contenuto e cinque voci, con la pagina corrente marcata", () => {
    render(
      <AppShell current="transactions">
        <p>Pagina</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Salta al contenuto" }).getAttribute("href")).toBe("#contenuto");
    const nav = screen.getByRole("navigation", { name: "Navigazione principale" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Panoramica",
      "Movimenti",
      "Aggiungi",
      "Personale",
      "Altro",
    ]);
    expect(within(nav).getByRole("link", { name: "Movimenti" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("main").id).toBe("contenuto");
  });
});

interface Row {
  readonly id: string;
  readonly name: string;
  readonly amount: number;
}

const ROWS: readonly Row[] = [
  { id: "a", name: "Casa", amount: 120000 },
  { id: "b", name: "Spesa", amount: 4835 },
  { id: "c", name: "Auto", amount: 15990 },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: "name", header: "Categoria", value: (row) => row.name },
  { id: "amount", header: "Importo", value: (row) => row.amount, align: "end" },
];

describe("DataTable", () => {
  it("disegna una tabella vera con caption, intestazioni e totali", () => {
    render(
      <DataTable
        caption="Spese"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        totals={{ amount: "1.408,25 €" }}
      />,
    );
    const table = screen.getByRole("table", { name: "Spese" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Casa", "Spesa", "Auto", "Totale"]);
    expect(table.querySelector("tfoot")?.textContent).toContain("1.408,25 €");
  });

  it("ordina dal bottone dell'intestazione e aggiorna aria-sort (numeri come numeri)", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Spese" columns={COLUMNS} rows={ROWS} getRowId={(row) => row.id} />);
    const header = screen.getByRole("columnheader", { name: /Importo/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    await user.click(within(header).getByRole("button"));
    const order = (): string[] =>
      screen
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent)
        .filter((text) => text !== "Totale");
    const firstDirection = header.getAttribute("aria-sort");
    expect(["ascending", "descending"]).toContain(firstDirection);
    expect(order()).toEqual(
      firstDirection === "ascending" ? ["Spesa", "Auto", "Casa"] : ["Casa", "Auto", "Spesa"],
    );
  });

  it("mostra lo stato vuoto", () => {
    render(<DataTable caption="Spese" columns={COLUMNS} rows={[]} getRowId={(row) => row.id} />);
    expect(screen.getByText("Nessun dato da mostrare.")).toBeTruthy();
  });
});

describe("FilterBar", () => {
  it("rimuove un filtro e azzera tutto", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [chips, setChips] = useState([
        { id: "a", label: "Categoria: Casa" },
        { id: "b", label: "Persona: Anna" },
      ]);
      return (
        <FilterBar
          chips={chips}
          onRemove={(ids) => {
            setChips((current) => current.filter((chip) => !ids.has(chip.id)));
          }}
          onClear={() => {
            setChips([]);
          }}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Rimuovi filtro Categoria: Casa" }));
    expect(screen.queryByText("Categoria: Casa")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(screen.queryByText("Persona: Anna")).toBeNull();
  });
});

describe("ChartFrame (AC-7)", () => {
  const data = [
    { mese: "Ott", uscite: 1000, entrate: 2000 },
    { mese: "Nov", uscite: 1500, entrate: 2100 },
  ];
  const format = (value: number): string => formatTest(cents(value));
  const formatTest = (value: Cents): string => `${String(value)} c`;

  const frame = (series: { key: string; label: string }[], state?: "loading" | "empty" | "error") => (
    <ChartFrame
      title="Andamento"
      summary="Le uscite crescono."
      series={series}
      data={data}
      categoryKey="mese"
      formatValue={format}
      {...(state ? { state } : {})}
    >
      {(colors) => (
        <LineChart width={300} height={200} data={data}>
          <YAxis />
          {series.map((item) => (
            <Line key={item.key} dataKey={item.key} stroke={colors[item.key] ?? ""} />
          ))}
        </LineChart>
      )}
    </ChartFrame>
  );

  it("con una serie niente legenda; con due la legenda c'è", () => {
    const { rerender } = render(frame([{ key: "uscite", label: "Uscite" }]));
    expect(screen.queryByRole("list", { name: "Legenda" })).toBeNull();
    rerender(
      frame([
        { key: "uscite", label: "Uscite" },
        { key: "entrate", label: "Entrate" },
      ]),
    );
    const legend = screen.getByRole("list", { name: "Legenda" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Uscite", "Entrate"]);
  });

  it("ha riassunto, tabella sempre presente per i lettori di schermo e il bottone Mostra tabella", async () => {
    const user = userEvent.setup();
    render(frame([{ key: "uscite", label: "Uscite" }]));
    expect(screen.getByRole("img", { name: "Le uscite crescono." })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Dati del grafico: Andamento" });
    expect(within(table).getByText("1500 c")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Mostra tabella" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Nascondi tabella" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("ha gli stati caricamento, vuoto ed errore", () => {
    const series = [{ key: "uscite", label: "Uscite" }];
    const { rerender } = render(frame(series, "loading"));
    expect(screen.getByRole("status", { name: "Caricamento del grafico…" })).toBeTruthy();
    rerender(frame(series, "empty"));
    expect(screen.getByText("Nessun movimento in questo periodo")).toBeTruthy();
    rerender(frame(series, "error"));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("rifiuta due assi verticali", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <ChartFrame
          title="Doppio"
          summary="x"
          series={[]}
          data={data}
          categoryKey="mese"
          formatValue={format}
        >
          {() => (
            <LineChart width={300} height={200} data={data}>
              <YAxis yAxisId="a" />
              <YAxis yAxisId="b" />
            </LineChart>
          )}
        </ChartFrame>,
      ),
    ).toThrow(/un solo asse verticale/);
    vi.restoreAllMocks();
  });
});
