// Barra di avanzamento per le operazioni lunghe (import, annullamento): accessibile come `progressbar`
// con etichetta e testo del valore letti dagli screen reader.
import { ProgressBar as AriaProgressBar, Label } from "react-aria-components";
import { cx } from "../cx";
import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  /** Testo del valore, es. "40 di 185". */
  readonly valueText: string;
}

export function ProgressBar({ label, value, max, valueText }: ProgressBarProps) {
  const safeMax = Math.max(max, 1);
  const clamped = Math.min(Math.max(value, 0), safeMax);
  return (
    <AriaProgressBar
      className={cx(styles.progress)}
      value={clamped}
      minValue={0}
      maxValue={safeMax}
      valueLabel={valueText}
    >
      {({ percentage = 0 }) => (
        <>
          <div className={cx(styles.header)}>
            <Label className={cx(styles.label)}>{label}</Label>
            <span className={cx(styles.value)}>{valueText}</span>
          </div>
          <div className={cx(styles.track)} aria-hidden="true">
            <div className={cx(styles.fill)} style={{ inlineSize: `${percentage}%` }} />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}
