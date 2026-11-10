// Guscio dell'app: salto al contenuto, barra laterale con tutte le sezioni da 64rem (comprimibile a sole
// icone); sotto, barra in basso con le voci principali e "Menu", che apre le sezioni in un pannello laterale.
import {
  Bell,
  LayoutDashboard,
  List,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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

/** Tutte le voci, per riconoscere la pagina corrente dal percorso. */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Le voci della barra in basso sul telefono; le altre stanno nel menù. */
const BAR_IDS: readonly NavId[] = ["overview", "transactions", "personal"];
const BAR_ITEMS = NAV_ITEMS.filter((item) => BAR_IDS.includes(item.id)).sort(
  (a, b) => BAR_IDS.indexOf(a.id) - BAR_IDS.indexOf(b.id),
);

/**
 * La voce di un percorso: quella con l'indirizzo più lungo che lo contiene ("/" solo esatto), così
 * `/ricorrenti/suggerimenti` è Ricorrenti e `/movimenti/nuovo` è Movimenti.
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

/** Barra laterale compressa a sole icone: preferenza del dispositivo, come il tema. */
export const NAV_COLLAPSED_KEY = "n2c.navCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(NAV_COLLAPSED_KEY, "1");
    else localStorage.removeItem(NAV_COLLAPSED_KEY);
  } catch {
    // Storage bloccato: la scelta vale finché la pagina resta aperta.
  }
}

function NavLink({
  item,
  current,
  badge,
  collapsed = false,
}: {
  readonly item: NavItem;
  readonly current: NavId | undefined;
  readonly badge: number;
  /** Barra compressa: il nome resta per gli screen reader e compare come suggerimento. */
  readonly collapsed?: boolean;
}) {
  const { href, label, icon: Icon } = item;
  return (
    <a
      className={cx(styles.navItem)}
      href={href}
      aria-current={item.id === current ? "page" : undefined}
      title={collapsed ? t(label) : undefined}
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
  collapsed = false,
}: {
  readonly current: NavId | undefined;
  readonly badges: Partial<Record<NavId, number>>;
  readonly collapsed?: boolean;
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
                <NavLink item={item} current={current} badge={badges[item.id] ?? 0} collapsed={collapsed} />
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleLabel = t(collapsed ? "nav.expand" : "nav.collapse");
  // Sul pulsante Menu: la somma dei numeri delle voci che stanno solo nel menù.
  const menuBadge = NAV_ITEMS.filter((item) => !BAR_IDS.includes(item.id)).reduce(
    (sum, item) => sum + (badges[item.id] ?? 0),
    0,
  );
  const inMenu = current !== undefined && !BAR_IDS.includes(current);
  return (
    <div className={cx(styles.shell)} data-collapsed={collapsed ? "" : undefined}>
      <a className={cx(styles.skip)} href={`#${MAIN_ID}`}>
        {t("shell.skip")}
      </a>
      <nav className={cx(styles.nav)} aria-label={t("nav.label")}>
        {/* Da 64rem: barra laterale con tutte le sezioni. */}
        <div className={cx(styles.side)} id="nav-side">
          <div className={cx(styles.sideHeader)}>
            <p className={cx(styles.brand)}>{t("app.title")}</p>
            <button
              type="button"
              className={cx(styles.collapse)}
              aria-controls="nav-side"
              aria-expanded={!collapsed}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => {
                saveCollapsed(!collapsed);
                setCollapsed(!collapsed);
              }}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} size={20} />
              ) : (
                <PanelLeftClose aria-hidden="true" strokeWidth={1.75} size={20} />
              )}
            </button>
          </div>
          <Sections current={current} badges={badges} collapsed={collapsed} />
          <div className={cx(styles.appearance)}>
            <ThemeSwitcher />
            <AccentPicker />
          </div>
        </div>
        {/* Sotto 64rem: barra in basso con le voci principali e il menù. */}
        <ul className={cx(styles.bar)}>
          {BAR_ITEMS.map((item) => (
            <li key={item.id} className={cx(styles.navEntry)}>
              <NavLink item={item} current={current} badge={badges[item.id] ?? 0} />
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
