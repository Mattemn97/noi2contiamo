// Il link di invito `/invito/:codice`: chi non ha la sessione passa da accesso o registrazione e torna qui.
import { useParams } from "react-router";
import { t } from "../../i18n/it";
import { Card, PageHeader } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { JoinForm } from "./JoinForm";

export function JoinPage() {
  const { code = "" } = useParams();
  return (
    <main className={cx(styles.center)}>
      <div className={cx(styles.narrow)}>
        <PageHeader title={t("join.pageTitle")} subtitle={t("join.pageSubtitle")} />
        <Card>
          <JoinForm code={code} />
        </Card>
      </div>
    </main>
  );
}
