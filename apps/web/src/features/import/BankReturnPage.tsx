// `/importa/banca`: la banca riporta qui con `code` e `state` (o `error`); si crea la sessione e si torna all'import.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { t } from "../../i18n/it";
import { Button, Card, PageHeader, Skeleton } from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import { BankApiError } from "./bankApi";
import { useBank } from "./bankApiContext";

export function BankReturnPage() {
  const { family } = useFamily();
  const { api } = useBank();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  const started = useRef(false);
  const [problem, setProblem] = useState<string | null>(
    denied ? t("bank.return.denied") : !code || !state ? t("bank.return.missing") : null,
  );

  useEffect(() => {
    if (started.current || problem !== null || !code || !state) return;
    started.current = true;
    api
      .createSession({ familyId: family.id, code, state })
      .then(async () => {
        await client.invalidateQueries({ queryKey: ["bank", family.id] });
        await navigate("/importa?fonte=banca", { replace: true });
      })
      .catch((error: unknown) => {
        setProblem(
          t("bank.return.error", { message: error instanceof BankApiError ? error.message : "" }).trim(),
        );
      });
  }, [api, client, code, family.id, navigate, problem, state]);

  return (
    <>
      <PageHeader title={t("bank.return.title")} />
      <Card as="section">
        {problem === null ? (
          <Skeleton lines={2} label={t("bank.return.working")} />
        ) : (
          <div className={cx(styles.stack)}>
            <p role="alert" className={cx(styles.error)}>
              {problem}
            </p>
            <div className={cx(styles.actions)}>
              <Button
                onPress={() => {
                  void navigate("/importa?fonte=banca", { replace: true });
                }}
              >
                {t("bank.return.back")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
