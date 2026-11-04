// Card e StatTile: superfici di contenuto. StatTile mostra un indicatore con la variazione (segno e freccia).
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Card.module.css";

export interface CardProps {
  readonly title?: string | undefined;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** Elemento HTML della card: `section` quando ha un titolo che apre una sezione. */
  readonly as?: "div" | "section" | "article";
}

export function Card({ title, actions, children, as: Tag = "div" }: CardProps) {
  return (
    <Tag className={cx(styles.card)}>
      {title !== undefined || actions !== undefined ? (
        <div className={cx(styles.header)}>
          {title !== undefined ? <h2 className={cx(styles.title)}>{title}</h2> : null}
          {actions !== undefined ? <div className={cx(styles.actions)}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

export type Trend = "up" | "down" | "flat";

export interface StatTileProps {
  readonly label: string;
  readonly value: string;
  /** Testo della variazione già formattato con il segno, es. "+12,5%". */
  readonly change?: string | undefined;
  readonly trend?: Trend;
  /** Spiegazione per i lettori di schermo, es. "rispetto a Ottobre 2026". */
  readonly changeLabel?: string | undefined;
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

export function StatTile({ label, value, change, trend = "flat", changeLabel }: StatTileProps) {
  const Icon = TREND_ICON[trend];
  return (
    <div className={cx(styles.card)}>
      <p className={cx(styles.statLabel)}>{label}</p>
      <p className={cx(styles.statValue)}>{value}</p>
      {change !== undefined ? (
        <p className={cx(styles.statChange)} data-trend={trend}>
          <Icon aria-hidden="true" strokeWidth={1.75} size={16} />
          <span>{change}</span>
          {changeLabel !== undefined ? (
            <span className={cx(styles.statChangeLabel)}>{changeLabel}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
