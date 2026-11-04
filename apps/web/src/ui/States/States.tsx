// I tre stati di ogni lista e grafico: vuoto, errore, caricamento (scheletro).
import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../../i18n/it";
import { Button } from "../Button/Button";
import { cx } from "../cx";
import styles from "./States.module.css";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className={cx(styles.state)}>
      <span className={cx(styles.icon)} aria-hidden="true">
        {icon ?? <Inbox strokeWidth={1.75} size={24} />}
      </span>
      <p className={cx(styles.title)}>{title}</p>
      {description !== undefined ? <p className={cx(styles.description)}>{description}</p> : null}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}

export function ErrorState({ title = t("common.errorTitle"), description, onRetry }: ErrorStateProps) {
  return (
    <div className={cx(styles.state)} role="alert">
      <span className={cx(styles.icon)} data-tone="danger" aria-hidden="true">
        <AlertTriangle strokeWidth={1.75} size={24} />
      </span>
      <p className={cx(styles.title)}>{title}</p>
      {description !== undefined ? <p className={cx(styles.description)}>{description}</p> : null}
      {onRetry !== undefined ? (
        <Button variant="secondary" onPress={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export interface SkeletonProps {
  /** Numero di righe dello scheletro (per le liste). */
  readonly lines?: number;
  /** Forma a blocco unico (per i grafici), con l'altezza in rem. */
  readonly blockHeight?: "chart" | "tile";
  readonly label?: string;
}

export function Skeleton({ lines = 3, blockHeight, label = t("common.loading") }: SkeletonProps) {
  return (
    <div className={cx(styles.skeleton)} role="status" aria-label={label}>
      {blockHeight !== undefined ? (
        <span className={cx(styles.block)} data-height={blockHeight} />
      ) : (
        Array.from({ length: lines }, (_, index) => <span key={index} className={cx(styles.line)} />)
      )}
    </div>
  );
}
