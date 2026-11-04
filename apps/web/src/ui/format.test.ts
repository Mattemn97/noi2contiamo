// AC-8: importi e date in it-IT, MoneyField senza virgola mobile.
import { cents, type BasisPoints } from "@noi2contiamo/core";
import { describe, expect, it } from "vitest";
import { amountText } from "./Amount/Amount";
import {
  formatBasisPoints,
  formatCents,
  formatDate,
  formatMonth,
  formatScaledInput,
  parseEuroInput,
  parsePercentInput,
} from "./format";

// Intl separa euro e numero con uno spazio unificatore: normalizziamo per leggere i test.
const plain = (text: string): string => text.replace(/[^\S\n]/g, " ");

describe("formatCents", () => {
  it.each([
    [123456, "1.234,56 €"],
    [1250, "12,50 €"],
    [5, "0,05 €"],
    [0, "0,00 €"],
    [-123456, "−1.234,56 €"],
    [123456789, "1.234.567,89 €"],
  ])("%i centesimi → %s", (value, expected) => {
    expect(plain(formatCents(cents(value)))).toBe(expected);
  });

  it("con il segno esplicito mostra + per le entrate", () => {
    expect(plain(formatCents(cents(1250), "always"))).toBe("+12,50 €");
  });
});

describe("Amount: segno sempre visibile", () => {
  it("entrata con +, uscita con −, a prescindere dal segno del valore", () => {
    expect(plain(amountText(cents(1250), "income"))).toBe("+12,50 €");
    expect(plain(amountText(cents(-1250), "income"))).toBe("+12,50 €");
    expect(plain(amountText(cents(1250), "expense"))).toBe("−12,50 €");
    expect(plain(amountText(cents(-99), "neutral"))).toBe("−0,99 €");
  });
});

describe("parseEuroInput", () => {
  it.each([
    ["12,5", 1250],
    ["1.234,56", 123456],
    ["12", 1200],
    ["0,05", 5],
    ["12.5", 1250],
    ["12.50", 1250],
    [" 1.234 ", 123400],
    ["1234,5", 123450],
    ["12,50 €", 1250],
    ["-3,20", -320],
    ["−3,20", -320],
    ["+3", 300],
    ["1.000.000,00", 100000000],
    ["0,10", 10],
  ])("%j → %i centesimi", (text, expected) => {
    expect(parseEuroInput(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "invalid"],
    ["12,3,4", "invalid"],
    ["1.23.4", "invalid"],
    ["12,345", "precision"],
    ["1e3", "invalid"],
    ["99999999999999999999", "invalid"],
  ])("%j → errore %s", (text, error) => {
    expect(parseEuroInput(text)).toEqual({ ok: false, error });
  });

  it("restituisce sempre interi esatti (nessun errore di virgola mobile)", () => {
    for (let euros = 0; euros < 50; euros += 1) {
      for (let centsPart = 0; centsPart < 100; centsPart += 7) {
        const text = `${String(euros)},${String(centsPart).padStart(2, "0")}`;
        const parsed = parseEuroInput(text);
        expect(parsed).toEqual({ ok: true, value: euros * 100 + centsPart });
      }
    }
  });

  it("formatScaledInput e parseEuroInput fanno andata e ritorno", () => {
    for (const value of [0, 5, 1250, 123456, 100000000]) {
      expect(parseEuroInput(formatScaledInput(value))).toEqual({ ok: true, value });
    }
  });
});

describe("percentuali in punti base", () => {
  it("PercentField consegna punti base", () => {
    expect(parsePercentInput("12,5")).toEqual({ ok: true, value: 1250 });
    expect(parsePercentInput("100")).toEqual({ ok: true, value: 10000 });
    expect(parsePercentInput("33,33 %")).toEqual({ ok: true, value: 3333 });
  });

  it("formatBasisPoints mostra la percentuale it-IT", () => {
    expect(plain(formatBasisPoints(1250 as BasisPoints))).toBe("12,5%");
    expect(plain(formatBasisPoints(10000 as BasisPoints))).toBe("100%");
  });
});

describe("date in italiano", () => {
  it("formatDate e formatMonth", () => {
    expect(formatDate(new Date(2026, 10, 3))).toBe("3 novembre 2026");
    expect(formatMonth(new Date(2026, 9, 1))).toBe("Ottobre 2026");
  });
});
