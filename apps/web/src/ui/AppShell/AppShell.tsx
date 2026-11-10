// Guscio dell'app: salto al contenuto, barra laterale con tutte le sezioni da 64rem; sotto, barra in
// basso con le voci principali e "Menu", che apre le stesse sezioni in un pannello laterale.
import {
  Bell,
  LayoutDashboard,
  List,
  Menu,
  Plus,
  Repeat,
  Scale,
  Settings,
  Sparkles,
  Store,
  Tags,
  TrendingUp,
  Upload,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { t, type MessageKey } from "../../i18n/it";
import { AccentPicker } from "../AccentPicker/AccentPicker";
import { cx } from "../cx";
import { Drawer } from "../Dialog/Dialog";
import { ThemeSwitcher } from "../ThemeSwitcher/ThemeSwitcher";
import styles from "./AppShell.module.css";

export type NavId =
  | "add"
  | "overview"
  | "transactions"
  | "personal"
  | "balance"
  | "import"
  | "rules"
  | "recurring"
  | "forecast"
  | "reminders"
  | "accounts"
  | "categories"
  | "payees"
  | "family"
  | "settings";

interface NavItem {
  readonly id: NavId;
  readonly href: string;
  readonly label: MessageKey;
  readonly icon: LucideIcon;
}

interface NavSection {
  readonly id: string;
  readonly title: MessageKey;
  readonly items: readonly NavItem[];
}

const ADD: NavItem = { id: "add", href: "/movimenti/nuovo", label: "nav.add", icon: Plus };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "main",
    title: "nav.section.main",
    items: [
      { id: "overview", href: "/", label: "nav.overview", icon: LayoutDashboard },
      { id: "transactions", href: "/movimenti", label: "nav.transactions", icon: List },
      { id: "personal", href: "/personale", label: "nav.personal", icon: User },
      { id: "balance", href: "/saldo", label: "nav.balance", icon: Scale },
    ],
  },
  {
    id: "automation",
    title: "nav.section.automation",
    items: [
      { id: "import", href: "/importa", label: "nav.import", icon: Upload },
      { id: "rules", href: "/altro/regole", label: "nav.rules", icon: Sparkles },
      { id: "recurring", href: "/ricorrenti", label: "nav.recurring", icon: Repeat },
      { id: "forecast", href: "/previsioni", label: "nav.forecast", icon: TrendingUp },
      { id: "reminders", href: "/promemoria", label: "nav.reminders", icon: Bell },
    ],
  },
  {
    id: "manage",
    title: "nav.section.manage",
    items: [
      { id: "accounts", href: "/altro/conti", label: "nav.accounts", icon: Wallet },
      { id: "categories", href: "/altro/categorie", label: "nav.categories", icon: Tags },
      { id: "payees", href: "/altro/destinatari", label: "nav.payees", icon: Store },
      { id: "family", href: "/altro/famiglia", label: "nav.family", icon: Users },
      { id: "settings", href: "/impostazioni", label: "nav.settings", icon: Settings },
    ],
  },
];

/** Tutte le voci, "Aggiungi" compreso: per riconoscere la pagina corrente dal percorso. */
export const NAV_ITEMS: readonly NavItem[] = [ADD, ...NAV_SECTIONS.flatMap((s) => s.items)];

/** Le voci della barra in basso sul telefono; le altre stanno nel menù. */
const BAR_IDS: readonly NavId[] = ["overview", "transactions", "add", "personal"];
const BAR_ITEMS = NAV_ITEMS.filter((item) => BAR_IDS.includes(item.id)).sort(
  (a, b) => BAR_IDS.indexOf(a.id) - BAR_IDS.indexOf(b.id),
);

/**
 * La voce di un percorso: quella con l'indirizzo più lungo che lo contiene ("/" solo esatto), così
 * `/ricorrenti/suggerimenti` è Ricorrenti e `/movimenti/nuovo` è Aggiungi.
 */
export function navFor(pathname: string): NavId | undefined {
  const matches = NAV_ITEMS.filter((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return [...matches].sort((a, b) => b.href.length - a.href.length)[0]?.id;
}

export interface AppShellProps {
  readonly current?: NavId | undefined;
  /** Numero da mostrare accanto a una voce (promemoria da vedere). */
  readonly badges?: Partial<Record<NavId, number>> | undefined;
  readonly children: ReactNode;
}

export const MAIN_ID = "contenuto";

function NavLink({
  item,
  current,
  badge,
  primary,
}: {
  readonly item: NavItem;
  readonly current: NavId | undefined;
  readonly badge: number;
  readonly primary?: boolean;
}) {
  const { href, label, icon: Icon } = item;
  return (
    <a
      className={cx(styles.navItem)}
      href={href}
      aria-current={item.id === current ? "page" : undefined}
      data-primary={primary ? "" : undefined}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} size={20} className={cx(styles.navIcon)} />
      <span className={cx(styles.navLabel)}>{t(label)}</span>
      {badge > 0 ? <span className={cx(styles.navBadge)}>{badge}</span> : null}
    </a>
  );
}

function Sections({
  current,
  badges,
}: {
  readonly current: NavId | undefined;
  readonly badges: Partial<Record<NavId, number>>;
}) {
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <section key={section.id} className={cx(styles.section)} aria-labelledby={`nav-${section.id}`}>
          <h2 id={`nav-${section.id}`} className={cx(styles.sectionTitle)}>
            {t(section.title)}
          </h2>
          <ul className={cx(styles.sectionList)}>
            {section.items.map((item) => (
              <li key={item.id} className={cx(styles.navEntry)}>
                <NavLink item={item} current={current} badge={badges[item.id] ?? 0} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function AppShell({ current, badges = {}, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Sul pulsante Menu: la somma dei numeri delle voci che stanno solo nel menù.
  const menuBadge = NAV_ITEMS.filter((item) => !BAR_IDS.includes(item.id)).reduce(
    (sum, item) => sum + (badges[item.id] ?? 0),
    0,
  );
  const inMenu = current !== undefined && !BAR_IDS.includes(current);
  return (
    <div className={cx(styles.shell)}>
      <a className={cx(styles.skip)} href={`#${MAIN_ID}`}>
        {t("shell.skip")}
      </a>
      <nav className={cx(styles.nav)} aria-label={t("nav.label")}>
        {/* Da 64rem: barra laterale con tutte le sezioni. */}
        <div className={cx(styles.side)}>
          <p className={cx(styles.brand)}>{t("app.title")}</p>
          <div className={cx(styles.addEntry)}>
            <NavLink item={ADD} current={current} badge={0} primary />
          </div>
          <Sections current={current} badges={badges} />
          <div className={cx(styles.appearance)}>
            <ThemeSwitcher />
            <AccentPicker />
          </div>
        </div>
        {/* Sotto 64rem: barra in basso con le voci principali e il menù. */}
        <ul className={cx(styles.bar)}>
          {BAR_ITEMS.map((item) => (
            <li key={item.id} className={cx(styles.navEntry)}>
              <NavLink
                item={item}
                current={current}
                badge={badges[item.id] ?? 0}
                primary={item.id === "add"}
              />
            </li>
          ))}
          <li className={cx(styles.navEntry)}>
            <button
              type="button"
              className={cx(styles.navItem)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-current={inMenu ? "page" : undefined}
              onClick={() => {
                setMenuOpen(true);
              }}
            >
              <Menu aria-hidden="true" strokeWidth={1.75} size={20} className={cx(styles.navIcon)} />
              <span className={cx(styles.navLabel)}>{t("nav.menu")}</span>
              {menuBadge > 0 ? <span className={cx(styles.navBadge)}>{menuBadge}</span> : null}
            </button>
          </li>
        </ul>
      </nav>
      <Drawer title={t("nav.menu")} isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <nav className={cx(styles.drawerNav)} aria-label={t("nav.menuLabel")}>
          <Sections current={current} badges={badges} />
          <div className={cx(styles.drawerAppearance)}>
            <ThemeSwitcher />
            <AccentPicker />
          </div>
        </nav>
      </Drawer>
      <main id={MAIN_ID} tabIndex={-1} className={cx(styles.main)}>
        {children}
      </main>
    </div>
  );
}
