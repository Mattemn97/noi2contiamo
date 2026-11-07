// "Dal conto bancario" (feature 24): collega una banca con Enable Banking e scarica i movimenti come righe
// dell'import, per l'anteprima e la conferma di sempre. Tre stati: non disponibile, da configurare, pronto.
import {
  bankBatchHash,
  bankBatchName,
  bankTransactionsToRows,
  suggestBankRange,
  type ImportBatch,
  type ParsedRow,
} from "@noi2contiamo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { t, type MessageKey } from "../../i18n/it";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  formatDate,
  Link,
  SearchField,
  Select,
  Skeleton,
  StatusBadge,
  TextField,
  useToast,
  type Option,
} from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import { BankApiError, type BankAccount, type BankApi, type BankConnection } from "./bankApi";
import { useBank } from "./bankApiContext";
import local from "./import.module.css";

export const BANK_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

/** Quello che serve alla procedura guidata per passare all'anteprima. */
export interface BankImport {
  readonly rows: ParsedRow[];
  readonly accountId: string;
  readonly fileName: string;
  readonly hash: string;
}

export const BANK_REDIRECT_PATH = "/importa/banca";

/** L'errore del backend in italiano. */
export function bankErrorText(error: unknown): string {
  if (error instanceof BankApiError) {
    const key = `bank.error.${error.code}` as MessageKey;
    try {
      return t(key, { message: error.message });
    } catch {
      return t("bank.error.generic");
    }
  }
  return t("bank.error.generic");
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isoToDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

export function BankSection({
  accounts,
  batches,
  onRows,
}: {
  readonly accounts: readonly Option[];
  readonly batches: readonly ImportBatch[];
  readonly onRows: (value: BankImport) => void;
}) {
  const { family } = useFamily();
  const { api } = useBank();
  const status = useQuery({
    queryKey: ["bank", family.id, "status"],
    queryFn: () => api.status(family.id),
    retry: false,
    staleTime: 60_000,
  });
  if (status.isPending) return <Skeleton lines={3} label={t("bank.checking")} />;
  if (status.data === null || status.data === undefined)
    return (
      <Card title={t("bank.unavailable.title")} as="section">
        <div className={cx(styles.stack)}>
          <p>{t("bank.unavailable.body")}</p>
          <p>
            <Link href={t("bank.guideUrl")} target="_blank" rel="noreferrer">
              {t("bank.unavailable.guide")}
            </Link>
          </p>
        </div>
      </Card>
    );
  if (!status.data.configured)
    return status.data.canConfigure ? (
      <ConfigCard api={api} familyId={family.id} />
    ) : (
      <Card title={t("bank.notConfigured.title")} as="section">
        <div className={cx(styles.stack)}>
          <p>{t("bank.notConfigured.member")}</p>
          <p className={cx(styles.muted)}>{t("bank.notConfigured.server")}</p>
        </div>
      </Card>
    );
  return <ReadyCard accounts={accounts} batches={batches} onRows={onRows} />;
}

function ConfigCard({ api, familyId }: { readonly api: BankApi; readonly familyId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const keyId = useId();
  const textId = useId();
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.saveConfig({ familyId, appId: appId.trim(), privateKeyPem: pem.trim() }),
    onSuccess: async () => {
      setPem("");
      toast.show({ message: t("bank.config.saved") });
      await client.invalidateQueries({ queryKey: ["bank", familyId] });
    },
    onError: (error) => {
      setProblem(
        error instanceof BankApiError && error.message
          ? t("bank.config.error", { message: error.message })
          : bankErrorText(error),
      );
    },
  });
  return (
    <Card title={t("bank.notConfigured.title")} as="section">
      <form
        className={cx(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (appId.trim() === "" || pem.trim() === "") {
            setProblem(t("bank.config.missing"));
            return;
          }
          setProblem(null);
          save.mutate();
        }}
      >
        <p>{t("bank.notConfigured.owner")}</p>
        <TextField label={t("bank.config.appId")} value={appId} onChange={setAppId} autoComplete="off" />
        <div className={cx(local.file)}>
          <label htmlFor={keyId} className={cx(local.label)}>
            {t("bank.config.keyFile")}
          </label>
          <input
            id={keyId}
            type="file"
            accept=".key,.pem,text/plain"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              if (!picked) return;
              picked
                .text()
                .then(setPem)
                .catch(() => {
                  setProblem(t("import.error.read"));
                });
            }}
          />
        </div>
        <div className={cx(local.file)}>
          <label htmlFor={textId} className={cx(local.label)}>
            {t("bank.config.keyText")}
          </label>
          <textarea
            id={textId}
            className={cx(local.textarea)}
            rows={5}
            spellCheck={false}
            autoComplete="off"
            value={pem}
            onChange={(event) => {
              setPem(event.currentTarget.value);
            }}
          />
        </div>
        {problem ? (
          <p role="alert" className={cx(styles.error)}>
            {problem}
          </p>
        ) : null}
        <div className={cx(styles.actions)}>
          <Button type="submit" isPending={save.isPending}>
            {t("bank.config.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ReadyCard({
  accounts,
  batches,
  onRows,
}: {
  readonly accounts: readonly Option[];
  readonly batches: readonly ImportBatch[];
  readonly onRows: (value: BankImport) => void;
}) {
  const { family } = useFamily();
  const { api } = useBank();
  const client = useQueryClient();
  const toast = useToast();
  const connections = useQuery({
    queryKey: ["bank", family.id, "connections"],
    queryFn: () => api.connections(family.id),
  });
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BankConnection | null>(null);
  const remove = useMutation({
    mutationFn: (connection: BankConnection) => api.deleteConnection(family.id, connection.id),
    onSuccess: async () => {
      toast.show({ message: t("bank.disconnected") });
      setSelected(null);
      await client.invalidateQueries({ queryKey: ["bank", family.id, "connections"] });
    },
  });
  const now = new Date().toISOString();
  const chosen = connections.data?.find((c) => c.id === selected) ?? null;

  return (
    <>
      <Card title={t("bank.connections")} as="section">
        <div className={cx(styles.stack)}>
          {connections.isPending ? <Skeleton lines={2} /> : null}
          {connections.isError ? (
            <p role="alert" className={cx(styles.error)}>
              {bankErrorText(connections.error)}
            </p>
          ) : null}
          {connections.data?.length === 0 ? <EmptyState title={t("bank.noConnections")} /> : null}
          {connections.data && connections.data.length > 0 ? (
            <ul className={cx(local.list)}>
              {connections.data.map((c) => {
                const expired = c.validUntil !== "" && c.validUntil < now;
                return (
                  <li key={c.id} className={cx(local.item)}>
                    <span>
                      {t("bank.connection", {
                        bank: c.bankName,
                        country: t(`bank.country.${c.country}` as MessageKey),
                        date: c.validUntil ? formatDate(isoToDate(c.validUntil)) : "—",
                      })}{" "}
                      {expired ? <StatusBadge status="critical" label={t("bank.expired")} /> : null}
                    </span>
                    <span className={cx(styles.actions)}>
                      <Button
                        size="sm"
                        isDisabled={expired}
                        onPress={() => {
                          setSelected(c.id);
                          setConnecting(false);
                        }}
                      >
                        {t("bank.use")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          setRemoving(c);
                        }}
                      >
                        {t("bank.disconnect")}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {remove.isError ? (
            <p role="alert" className={cx(styles.error)}>
              {bankErrorText(remove.error)}
            </p>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button
              variant="secondary"
              onPress={() => {
                setConnecting(true);
                setSelected(null);
              }}
            >
              {t("bank.connect")}
            </Button>
          </div>
        </div>
      </Card>
      {connecting ? <ConnectCard /> : null}
      {chosen ? (
        <DownloadCard connection={chosen} accounts={accounts} batches={batches} onRows={onRows} />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t("bank.disconnect.title")}
          message={t("bank.disconnect.body", { bank: removing.bankName })}
          confirmLabel={t("bank.disconnect")}
          isOpen
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          onConfirm={() => {
            remove.mutate(removing);
          }}
        />
      ) : null}
    </>
  );
}

function ConnectCard() {
  const { family } = useFamily();
  const { api, redirect } = useBank();
  const [country, setCountry] = useState("IT");
  const [needle, setNeedle] = useState("");
  const countries = useMemo<Option[]>(
    () =>
      BANK_COUNTRIES.map((code) => ({ id: code, label: t(`bank.country.${code}` as MessageKey) })).sort(
        (a, b) => a.label.localeCompare(b.label, "it"),
      ),
    [],
  );
  const banks = useQuery({
    queryKey: ["bank", family.id, "aspsps", country],
    queryFn: () => api.aspsps(family.id, country),
    staleTime: 10 * 60_000,
  });
  const start = useMutation({
    mutationFn: async (name: string) =>
      api.startAuth({
        familyId: family.id,
        aspspName: name,
        country,
        redirectUrl: `${window.location.origin}${BANK_REDIRECT_PATH}`,
      }),
    onSuccess: (url) => {
      redirect(url);
    },
  });
  const shown = (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(needle.trim().toLowerCase()));
  return (
    <Card title={t("bank.connect")} as="section">
      <div className={cx(styles.stack)}>
        <div className={cx(styles.form)}>
          <Select
            label={t("bank.country")}
            options={countries}
            value={country}
            onChange={(key) => {
              if (key !== null) {
                setCountry(String(key));
                setNeedle("");
              }
            }}
          />
          <SearchField label={t("bank.search")} value={needle} onChange={setNeedle} />
        </div>
        {banks.isPending ? <Skeleton lines={3} label={t("bank.loadingBanks")} /> : null}
        {banks.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {bankErrorText(banks.error)}
          </p>
        ) : null}
        {banks.data && shown.length === 0 ? <p className={cx(styles.muted)}>{t("bank.noBanks")}</p> : null}
        {shown.length > 0 ? (
          <ul className={cx(local.banks)} aria-label={t("bank.pick")}>
            {shown.slice(0, 100).map((bank) => (
              <li key={bank.name}>
                <Button
                  variant="secondary"
                  isDisabled={start.isPending}
                  onPress={() => {
                    start.mutate(bank.name);
                  }}
                >
                  {bank.logo ? (
                    <img
                      className={cx(local.logo)}
                      src={bank.logo}
                      alt={t("bank.logo", { bank: bank.name })}
                    />
                  ) : null}
                  {bank.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {start.isPending ? <p role="status">{t("bank.redirecting")}</p> : null}
        {start.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {bankErrorText(start.error)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function DownloadCard({
  connection,
  accounts,
  batches,
  onRows,
}: {
  readonly connection: BankConnection;
  readonly accounts: readonly Option[];
  readonly batches: readonly ImportBatch[];
  readonly onRows: (value: BankImport) => void;
}) {
  const { family } = useFamily();
  const { api } = useBank();
  const [bankAccount, setBankAccount] = useState<BankAccount | null>(connection.accounts[0] ?? null);
  const [appAccount, setAppAccount] = useState<string | null>(null);
  const today = localToday();
  const [range, setRange] = useState<{ dateFrom: string; dateTo: string } | null>(null);
  const suggested = appAccount ? suggestBankRange(batches, appAccount, today) : null;
  const { dateFrom, dateTo } = range ?? suggested ?? { dateFrom: "", dateTo: today };
  const [empty, setEmpty] = useState(false);

  const download = useMutation({
    mutationFn: async () => {
      if (!bankAccount || !appAccount) return;
      const { transactions } = await api.transactions({
        familyId: family.id,
        connectionId: connection.id,
        accountUid: bankAccount.uid,
        dateFrom,
        dateTo,
      });
      const rows = bankTransactionsToRows(transactions);
      if (rows.length === 0) {
        setEmpty(true);
        return;
      }
      onRows({
        rows,
        accountId: appAccount,
        fileName: bankBatchName({ bankName: connection.bankName, iban: bankAccount.iban, dateFrom, dateTo }),
        hash: bankBatchHash({ connectionId: connection.id, accountUid: bankAccount.uid, dateFrom, dateTo }),
      });
    },
  });
  const accountOptions: Option[] = connection.accounts.map((a) => ({
    id: a.uid,
    label: [a.name || connection.bankName, a.iban].filter(Boolean).join(" · "),
  }));
  const invalidRange = dateFrom === "" || dateTo === "" || dateFrom > dateTo;

  if (accounts.length === 0)
    return (
      <Card title={t("bank.accounts")} as="section">
        <p>{t("bank.noAppAccounts")}</p>
      </Card>
    );
  return (
    <Card title={t("bank.accounts")} as="section">
      <div className={cx(styles.stack)}>
        <div className={cx(local.grid)}>
          <Select
            label={t("bank.bankAccount")}
            options={accountOptions}
            value={bankAccount?.uid ?? null}
            onChange={(key) => {
              setBankAccount(connection.accounts.find((a) => a.uid === String(key)) ?? null);
            }}
          />
          <Select
            label={t("bank.appAccount")}
            options={accounts}
            value={appAccount}
            onChange={(key) => {
              setAppAccount(key === null ? null : String(key));
              setRange(null);
            }}
          />
          <TextField
            label={t("bank.from")}
            type="date"
            value={dateFrom}
            onChange={(value) => {
              setRange({ dateFrom: value, dateTo });
            }}
          />
          <TextField
            label={t("bank.to")}
            type="date"
            value={dateTo}
            onChange={(value) => {
              setRange({ dateFrom, dateTo: value });
            }}
          />
        </div>
        {empty ? <p role="status">{t("bank.empty")}</p> : null}
        {download.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {bankErrorText(download.error)}
          </p>
        ) : null}
        <div className={cx(styles.actions)}>
          <Button
            isPending={download.isPending}
            isDisabled={!bankAccount || !appAccount || invalidRange}
            onPress={() => {
              setEmpty(false);
              download.mutate();
            }}
          >
            {download.isPending ? t("bank.fetching") : t("bank.fetch")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
