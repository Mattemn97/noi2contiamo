// DataTable: stato (ordinamento) da @tanstack/react-table v9, markup HTML vero: <caption>, <th scope>,
// aria-sort, totali in <tfoot>. Scorre dentro il suo contenitore con la prima colonna fissa.
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { t } from "../../i18n/it";
import { cx } from "../cx";
import styles from "./DataTable.module.css";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});

export interface DataTableColumn<T> {
  readonly id: string;
  readonly header: string;
  /** Valore per l'ordinamento (numero per importi e date, testo per il resto). */
  readonly value: (row: T) => string | number;
  /** Contenuto della cella; senza, si mostra `value` come testo. */
  readonly cell?: (row: T) => ReactNode;
  /** Importi a destra, testo a sinistra. */
  readonly align?: "start" | "end";
  readonly sortable?: boolean;
  /** Nasconde la colonna sotto `48rem` (il registro la mostra come seconda riga della cella principale). */
  readonly hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowId: (row: T) => string;
  /** Riga dei totali: contenuto per id di colonna (la prima colonna mostra "Totale" se manca). */
  readonly totals?: Readonly<Record<string, ReactNode>>;
  /** Nasconde il titolo a vista (resta per i lettori di schermo). */
  readonly hideCaption?: boolean;
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export function DataTable<T extends RowData>({
  caption,
  columns,
  rows,
  getRowId,
  totals,
  hideCaption = false,
}: DataTableProps<T>) {
  const columnDefs = useMemo(
    () =>
      columns.map((column): ColumnDef<typeof features, T> => ({
        id: column.id,
        accessorFn: (row: T) => column.value(row),
        header: column.header,
        enableSorting: column.sortable ?? true,
        sortFn: rows[0] !== undefined && typeof column.value(rows[0]) === "number" ? "basic" : "alphanumeric",
        cell: (context) =>
          column.cell ? column.cell(context.row.original) : String(column.value(context.row.original)),
      })),
    [columns, rows],
  );
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({ features, columns: columnDefs, data, getRowId: (row: T) => getRowId(row) });
  const alignOf = (id: string): "start" | "end" =>
    columns.find((column) => column.id === id)?.align ?? "start";
  const hideOf = (id: string): "mobile" | undefined =>
    columns.find((column) => column.id === id)?.hideOnMobile ? "mobile" : undefined;

  return (
    // Il contenitore scorre in orizzontale: deve ricevere il focus per scorrere da tastiera (axe scrollable-region-focusable).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={cx(styles.scroller)} role="region" aria-label={caption} tabIndex={0}>
      <table className={cx(styles.table)}>
        <caption className={cx(hideCaption ? "visually-hidden" : styles.caption)}>{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const toggle = header.column.getToggleSortingHandler();
                const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    data-align={alignOf(header.column.id)}
                    data-hide={hideOf(header.column.id)}
                    aria-sort={canSort ? (sorted ? ARIA_SORT[sorted] : "none") : undefined}
                  >
                    {canSort && toggle ? (
                      <button type="button" className={cx(styles.sort)} onClick={toggle}>
                        <table.FlexRender header={header} />
                        <Icon aria-hidden="true" strokeWidth={1.75} size={16} />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={cx(styles.empty)}>
                {t("table.empty")}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell, index) =>
                  index === 0 ? (
                    <th
                      key={cell.id}
                      scope="row"
                      data-align={alignOf(cell.column.id)}
                      data-hide={hideOf(cell.column.id)}
                    >
                      <table.FlexRender cell={cell} />
                    </th>
                  ) : (
                    <td key={cell.id} data-align={alignOf(cell.column.id)} data-hide={hideOf(cell.column.id)}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
        {totals ? (
          <tfoot>
            <tr>
              {columns.map((column, index) =>
                index === 0 ? (
                  <th
                    key={column.id}
                    scope="row"
                    data-align={column.align ?? "start"}
                    data-hide={column.hideOnMobile ? "mobile" : undefined}
                  >
                    {totals[column.id] ?? t("table.total")}
                  </th>
                ) : (
                  <td
                    key={column.id}
                    data-align={column.align ?? "start"}
                    data-hide={column.hideOnMobile ? "mobile" : undefined}
                  >
                    {totals[column.id]}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
