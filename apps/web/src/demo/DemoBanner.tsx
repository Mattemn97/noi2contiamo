// Fascia della demo del sito: dati inventati, credenziali per rientrare, ritorno alla presentazione.
import { t } from "../i18n/it";
import { DEMO_EMAILS, DEMO_PASSWORD } from "./credentials";
import styles from "./DemoBanner.module.css";

export function DemoBanner() {
  return (
    <aside className={styles.banner} aria-label={t("demo.label")}>
      <span>{t("demo.notice")}</span>
      <span>{t("demo.credentials", { email: DEMO_EMAILS.owner, password: DEMO_PASSWORD })}</span>
      <a href="../">{t("demo.back")}</a>
    </aside>
  );
}
