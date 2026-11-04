import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className={cx(styles.header)}>
      <div className={cx(styles.text)}>
        <h1 className={cx(styles.title)}>{title}</h1>
        {subtitle !== undefined ? <p className={cx(styles.subtitle)}>{subtitle}</p> : null}
      </div>
      {actions !== undefined ? <div className={cx(styles.actions)}>{actions}</div> : null}
    </header>
  );
}
