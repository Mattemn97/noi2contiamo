// PDF del report (feature 18). Si carica solo al clic (import dinamico di jsPDF). Grafici disegnati a mano:
// ogni barra ha un tratteggio diverso e l'etichetta diretta con il valore, così restano leggibili in bianco e nero.
import type { ReportData } from "@noi2contiamo/core";

export interface ReportLabels {
  readonly title: string;
  readonly subtitle: string;
  readonly period: string;
  readonly generated: string;
  readonly kpis: string;
  readonly income: string;
  readonly expense: string;
  readonly savings: string;
  readonly rate: string;
  readonly noRate: string;
  readonly categories: string;
  readonly noData: string;
  readonly others: string;
  readonly paid: string;
  readonly balance: string;
  readonly balanceNote: string;
  readonly colMember: string;
  readonly colPaid: string;
  readonly colShare: string;
  readonly colNet: string;
}

export interface ReportText {
  readonly money: (cents: number) => string;
  readonly signed: (cents: number) => string;
  readonly percent: (bp: number) => string;
  readonly categoryName: (id: string | null) => string;
  readonly memberName: (id: string | null) => string;
}

type Doc = import("jspdf").jsPDF;
type Pattern = "solid" | "up" | "down" | "horizontal" | "vertical" | "cross" | "light" | "empty";
const PATTERNS: readonly Pattern[] = [
  "solid",
  "up",
  "down",
  "horizontal",
  "vertical",
  "cross",
  "light",
  "empty",
];
const patternAt = (i: number): Pattern => PATTERNS[i % PATTERNS.length] ?? "solid";

const MARGIN = 15;
const WIDTH = 210;
const BOTTOM = 280;

/** La sola codifica che jsPDF (Helvetica, WinAnsi) sa stampare: spazi e segno meno normali. */
export const pdfSafe = (text: string): string =>
  text.replace(/[\u00a0\u202f\u2009]/g, " ").replace(/\u2212/g, "-");

function hatch(doc: Doc, x: number, y: number, w: number, h: number, pattern: Pattern): void {
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  doc.setLineWidth(0.25);
  if (pattern === "solid") doc.rect(x, y, w, h, "F");
  else if (pattern === "light") {
    doc.setFillColor(200, 200, 200);
    doc.rect(x, y, w, h, "F");
  }
  const step = 1.6;
  const diagonal = (dir: 1 | -1) => {
    for (let k = -h; k <= w; k += step) {
      // Segmento da (x0, basso) a (x1, alto), tagliato dentro [0, w].
      const x0 = dir === 1 ? k : k + h;
      const x1 = dir === 1 ? k + h : k;
      const dx = x1 - x0;
      const ta = (0 - x0) / dx;
      const tb = (w - x0) / dx;
      const t0 = Math.max(0, Math.min(ta, tb));
      const t1 = Math.min(1, Math.max(ta, tb));
      if (t0 >= t1) continue;
      doc.line(x + x0 + dx * t0, y + h - h * t0, x + x0 + dx * t1, y + h - h * t1);
    }
  };
  if (pattern === "up") diagonal(1);
  if (pattern === "down") diagonal(-1);
  if (pattern === "horizontal" || pattern === "cross")
    for (let k = step; k < h; k += step) doc.line(x, y + k, x + w, y + k);
  if (pattern === "vertical" || pattern === "cross")
    for (let k = step; k < w; k += step) doc.line(x + k, y, x + k, y + h);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h, "S");
}

function fit(doc: Doc, label: string, width: number): string {
  const lines: unknown = doc.splitTextToSize(label, width);
  return Array.isArray(lines) ? String(lines[0] ?? "") : label;
}

interface Bar {
  readonly label: string;
  readonly cents: number;
}

/** Barre orizzontali: nome a sinistra, valore a destra, tratteggio diverso per ogni barra. */
function barChart(doc: Doc, bars: readonly Bar[], y: number, text: ReportText): number {
  const labelW = 55;
  const valueW = 28;
  const maxW = WIDTH - 2 * MARGIN - labelW - valueW;
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.cents)));
  let cursor = y;
  bars.forEach((bar, i) => {
    if (cursor > BOTTOM - 8) {
      doc.addPage();
      cursor = MARGIN;
    }
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    doc.text(pdfSafe(fit(doc, bar.label, labelW - 2)), MARGIN, cursor + 4.5);
    const w = Math.max(0.8, (Math.abs(bar.cents) / max) * maxW);
    hatch(doc, MARGIN + labelW, cursor, w, 6, patternAt(i));
    doc.text(pdfSafe(text.money(bar.cents)), MARGIN + labelW + w + 2, cursor + 4.5);
    cursor += 8;
  });
  return cursor;
}

/** Una barra sola divisa in parti, con la legenda sotto (tratteggio + nome + valore). */
function stackedBar(doc: Doc, parts: readonly Bar[], y: number, text: ReportText): number {
  const total = parts.reduce((s, p) => s + p.cents, 0);
  const full = WIDTH - 2 * MARGIN;
  let x = MARGIN;
  parts.forEach((p, i) => {
    const w = total > 0 ? (p.cents / total) * full : 0;
    if (w > 0) hatch(doc, x, y, w, 8, patternAt(i));
    x += w;
  });
  let cursor = y + 14;
  parts.forEach((p, i) => {
    hatch(doc, MARGIN, cursor - 3.5, 8, 4.5, patternAt(i));
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    const pct = total > 0 ? ` (${text.percent(Math.round((p.cents * 10000) / total))})` : "";
    doc.text(pdfSafe(`${p.label}: ${text.money(p.cents)}${pct}`), MARGIN + 11, cursor);
    cursor += 6;
  });
  return cursor;
}

function heading(doc: Doc, title: string, y: number): number {
  let at = y;
  if (at > BOTTOM - 30) {
    doc.addPage();
    at = MARGIN;
  }
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(0, 0, 0);
  doc.text(pdfSafe(title), MARGIN, at + 5);
  doc.setLineWidth(0.3).line(MARGIN, at + 7, WIDTH - MARGIN, at + 7);
  return at + 12;
}

/** Costruisce il PDF e ne restituisce i byte. */
export async function buildReportPdf(
  data: ReportData,
  labels: ReportLabels,
  text: ReportText,
): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: pdfSafe(`${labels.title} ${labels.period}`) });

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(0, 0, 0);
  doc.text(pdfSafe(labels.title), MARGIN, MARGIN + 6);
  doc.setFont("helvetica", "normal").setFontSize(11);
  doc.text(pdfSafe(`${labels.period} - ${labels.subtitle}`), MARGIN, MARGIN + 13);
  doc.setFontSize(8).text(pdfSafe(labels.generated), MARGIN, MARGIN + 18);

  let y = heading(doc, labels.kpis, MARGIN + 22);
  const k = data.kpis;
  const rows: readonly (readonly [string, string])[] = [
    [labels.income, text.money(k.incomeCents)],
    [labels.expense, text.money(k.expenseCents)],
    [labels.savings, text.signed(k.savingsCents)],
    [labels.rate, k.savingsRateBp === null ? labels.noRate : text.percent(k.savingsRateBp)],
  ];
  rows.forEach(([name, value]) => {
    doc.setFont("helvetica", "normal").setFontSize(10).text(pdfSafe(name), MARGIN, y);
    doc.setFont("helvetica", "bold").text(pdfSafe(value), WIDTH - MARGIN, y, { align: "right" });
    y += 6;
  });

  y = heading(doc, labels.categories, y + 4);
  if (data.categories.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(10).text(pdfSafe(labels.noData), MARGIN, y);
    y += 8;
  } else {
    const top = data.categories
      .slice(0, 7)
      .map((c) => ({ label: text.categoryName(c.categoryId), cents: c.cents }));
    const rest = data.categories.slice(7).reduce((s, c) => s + c.cents, 0);
    y = barChart(doc, rest > 0 ? [...top, { label: labels.others, cents: rest }] : top, y, text);
  }

  y = heading(doc, labels.paid, y + 4);
  if (data.contributions.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(10).text(pdfSafe(labels.noData), MARGIN, y);
    y += 8;
  } else {
    y = stackedBar(
      doc,
      data.contributions.map((c) => ({ label: text.memberName(c.memberId), cents: c.cents })),
      y,
      text,
    );
  }

  if (data.balances) {
    y = heading(doc, labels.balance, y + 4);
    const cols = [MARGIN, 85, 125, WIDTH - MARGIN] as const;
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text(pdfSafe(labels.colMember), cols[0], y);
    doc.text(pdfSafe(labels.colPaid), cols[1], y, { align: "right" });
    doc.text(pdfSafe(labels.colShare), cols[2], y, { align: "right" });
    doc.text(pdfSafe(labels.colNet), cols[3], y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
    for (const b of data.balances) {
      doc.text(pdfSafe(text.memberName(b.memberId)), cols[0], y);
      doc.text(pdfSafe(text.money(b.paidCents)), cols[1], y, { align: "right" });
      doc.text(pdfSafe(text.money(b.expenseShareCents)), cols[2], y, { align: "right" });
      doc.setFont("helvetica", "bold").text(pdfSafe(text.signed(b.netCents)), cols[3], y, { align: "right" });
      doc.setFont("helvetica", "normal");
      y += 6;
    }
    doc.setFontSize(8).text(pdfSafe(labels.balanceNote), MARGIN, y + 2);
  }
  return doc.output("arraybuffer");
}

/** Avvia il download nel browser. */
export function downloadBytes(bytes: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
