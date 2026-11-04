// Importo in euro it-IT con segno esplicito. Entrate: "+" e colore di successo; uscite: "−" e colore normale.
import { cents, type Cents } from "@noi2contiamo/core";
import { formatCents } from "../format";
import { cx } from "../cx";
import styles from "./Amount.module.css";

export type AmountKind = "income" | "expense" | "neutral";

export interface AmountProps {
  readonly value: Cents;
  /** `income` mostra sempre il "+", `expense` sempre il "−"; `neutral` il segno del numero. */
  readonly kind?: AmountKind;
}

export function amountText(value: Cents, kind: AmountKind = "neutral"): string {
  if (kind === "neutral") return formatCents(value);
  const magnitude = Math.abs(value);
  return formatCents(cents(kind === "income" ? magnitude : -magnitude), "always");
}

export function Amount({ value, kind = "neutral" }: AmountProps) {
  return (
    <span className={cx(styles.amount)} data-kind={kind}>
      {amountText(value, kind)}
    </span>
  );
}
