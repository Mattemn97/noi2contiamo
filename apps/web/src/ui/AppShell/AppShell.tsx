// Guscio dell'app: salto al contenuto, navigazione in basso sotto 64rem e laterale da 64rem, area contenuto.
import { LayoutDashboard, List, MoreHorizontal, Plus, User, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { t, type MessageKey } from "../../i18n/it";
import { cx } from "../cx";
import styles from "./AppShell.module.css";

export type NavId = "overview" | "transactions" | "add" | "personal" | "more";

interface NavItem {
  readonly id: NavId;
  readonly href: string;
  readonly label: MessageKey;
  readonly icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", href: "/", label: "nav.overview", icon: LayoutDashboard },
  { id: "transactions", href: "/movimenti", label: "nav.transactions", icon: List },
  { id: "add", href: "/movimenti/nuovo", label: "nav.add", icon: Plus },
  { id: "personal", href: "/personale", label: "nav.personal", icon: User },
  { id: "more", href: "/altro", label: "nav.more", icon: MoreHorizontal },
];

export interface AppShellProps {
  readonly current?: NavId | undefined;
  readonly children: ReactNode;
}

export const MAIN_ID = "contenuto";

export function AppShell({ current, children }: AppShellProps) {
  return (
    <div className={cx(styles.shell)}>
      <a className={cx(styles.skip)} href={`#${MAIN_ID}`}>
        {t("shell.skip")}
      </a>
      <nav className={cx(styles.nav)} aria-label={t("nav.label")}>
        <p className={cx(styles.brand)}>{t("app.title")}</p>
        <ul className={cx(styles.navList)}>
          {NAV_ITEMS.map(({ id, href, label, icon: Icon }) => (
            <li key={id} className={cx(styles.navEntry)} data-primary={id === "add" ? "" : undefined}>
              <a
                className={cx(styles.navItem)}
                href={href}
                aria-current={id === current ? "page" : undefined}
                data-primary={id === "add" ? "" : undefined}
              >
                <Icon aria-hidden="true" strokeWidth={1.75} size={20} className={cx(styles.navIcon)} />
                <span className={cx(styles.navLabel)}>{t(label)}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id={MAIN_ID} tabIndex={-1} className={cx(styles.main)}>
        {children}
      </main>
    </div>
  );
}
