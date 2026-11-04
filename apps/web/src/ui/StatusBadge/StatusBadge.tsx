// Stato con colore fisso + icona + etichetta: il colore non porta mai il significato da solo.
import { AlertCircle, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cx } from "../cx";
import styles from "./StatusBadge.module.css";

export type Status = "good" | "warning" | "serious" | "critical";

const ICONS = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertCircle,
  critical: XCircle,
} as const;

export interface StatusBadgeProps {
  readonly status: Status;
  readonly label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const Icon = ICONS[status];
  return (
    <span className={cx(styles.badge)} data-status={status}>
      <Icon aria-hidden="true" strokeWidth={1.75} size={16} className={cx(styles.icon)} />
      {label}
    </span>
  );
}
