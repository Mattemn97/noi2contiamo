// Import CSV (feature 11, spec 0006): File → Colonne → Anteprima → Conferma → Risultato, più lo storico
// dei lotti con "Annulla import". Il file si legge nel browser con `core`; si scrive con `commit`.
import {
  cents,
  columnIndex,
  DATE_FORMATS,
  decodeBytes,
  fileHash,
  guessSettings,
  matchProfile,
  newId,
  pickable,
  planImport,
  planWindow,
  readRows,
  settingsOf,
  undoImportOps,
  type ColRef,
  type ImportBatch,
  type ImportPlan,
  type ImportProfile,
  type ImportSettings,
  type PlanItem,
  type SignMode,
  type Transaction,
} from "@noi2contiamo/core";
import { chunkOps, type CommitOp, type Cursor } from "@noi2contiamo/data";
import { getLocalTimeZone, parseDate as parseCalendarDate } from "@internationalized/date";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap, useCollection, useTransactionsInRange } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Amount,
  amountText,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  formatDate,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  TextField,
  useToast,
  type DataTableColumn,
  type Option,
  type Status,
} from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import local from "./import.module.css";
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  profileDoc,
  rawRows,
  rowErrorText,
  sameSettings,
  splitValues,
  statusLabel,
  STEP_NAMES,
  suggestedName,
  type WizardStep,
} from "./importWizard";

const asDate = (iso: string) => formatDate(parseCalendarDate(iso).toDate(getLocalTimeZone()));

interface Loaded {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly hash: string;
}

export function ImportPage() {
  const { family } = useFamily();
  const accounts = useCollection(family.id, "accounts");
  const profiles = useCollection(family.id, "importProfiles");
  const batches = useCollection(family.id, "importBatches");
  const [step, setStep] = useState<WizardStep>("file");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [file, setFile] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<ImportSettings | null>(null);
  const [profile, setProfile] = useState<ImportProfile | null>(null);
  const [result, setResult] = useState<ImportPlan["counts"] | null>(null);

  if (accounts.isPending || profiles.isPending || batches.isPending) return <Skeleton lines={6} />;
  if (accounts.isError || profiles.isError || batches.isError)
    return (
      <ErrorState
        onRetry={() => void Promise.all([accounts.refetch(), profiles.refetch(), batches.refetch()])}
      />
    );

  const reset = () => {
    setStep("file");
    setFile(null);
    setSettings(null);
    setProfile(null);
    setResult(null);
  };
  const stepIndex = step === "result" ? 4 : STEP_NAMES.indexOf(step);

  return (
    <>
      <PageHeader title={t("import.title")} subtitle={t("import.subtitle")} />
      <div className={cx(styles.stack)}>
        <ol className={cx(local.steps)} aria-label={t("import.steps")}>
          {STEP_NAMES.map((name, i) => (
            <li
              key={name}
              aria-current={i === stepIndex ? "step" : undefined}
              data-done={i < stepIndex || undefined}
            >
              {t(`import.step.${name}`)}
            </li>
          ))}
        </ol>
        <p className={cx(local.srOnly)} aria-live="polite">
          {t("import.stepOf", {
            n: String(stepIndex + 1),
            name: t(`import.step.${STEP_NAMES[stepIndex] ?? "file"}`),
          })}
        </p>
        {step === "file" ? (
          <FileStep
            accounts={pickable(accounts.data).map((a) => ({ id: a.id, label: a.name }))}
            accountId={accountId}
            onAccount={setAccountId}
            onLoaded={(loaded) => {
              const found = matchProfile(loaded.bytes, profiles.data, accountId);
              const chosen = accountId ?? found?.defaultAccountId ?? null;
              setFile(loaded);
              setAccountId(chosen);
              setProfile(found);
              setSettings(found ? settingsOf(found) : guessSettings(loaded.bytes));
              setStep(found ? "preview" : "columns");
            }}
          />
        ) : null}
        {step === "columns" && file && settings ? (
          <ColumnsStep
            bytes={file.bytes}
            settings={settings}
            onChange={setSettings}
            onBack={reset}
            onNext={() => {
              setStep("preview");
            }}
          />
        ) : null}
        {step === "preview" && file && settings && accountId ? (
          <PreviewStep
            file={file}
            settings={settings}
            profile={profile}
            accountId={accountId}
            batches={batches.data}
            onColumns={() => {
              setStep("columns");
            }}
            onDone={(counts) => {
              setResult(counts);
              setStep("result");
            }}
          />
        ) : null}
        {step === "result" && result ? <ResultStep counts={result} onAgain={reset} /> : null}
        {step === "file" ? (
          <HistoryCard
            batches={batches.data}
            accountName={(id) => accounts.data.find((a) => a.id === id)?.name ?? id}
          />
        ) : null}
      </div>
    </>
  );
}

function FileStep({
  accounts,
  accountId,
  onAccount,
  onLoaded,
}: {
  readonly accounts: readonly Option[];
  readonly accountId: string | null;
  readonly onAccount: (id: string | null) => void;
  readonly onLoaded: (file: Loaded) => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card title={t("import.step.file")} as="section">
      <div className={cx(styles.form)}>
        <Select
          label={t("import.account")}
          description={t("import.accountHelp")}
          options={accounts}
          value={accountId}
          onChange={(key) => {
            onAccount(key === null ? null : String(key));
          }}
        />
        <div className={cx(local.file)}>
          <label htmlFor={inputId} className={cx(local.label)}>
            {t("import.file")}
          </label>
          <input
            id={inputId}
            type="file"
            accept=".csv,.txt,text/csv"
            aria-describedby={helpId}
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!picked) return;
              if (accountId === null) {
                setProblem(t("import.error.noAccount"));
                return;
              }
              if (picked.size > MAX_FILE_BYTES) {
                setProblem(t("import.error.size"));
                return;
              }
              picked
                .arrayBuffer()
                .then((buffer) => {
                  const bytes = new Uint8Array(buffer);
                  if (bytes.length === 0) {
                    setProblem(t("import.error.empty"));
                    return;
                  }
                  setProblem(null);
                  onLoaded({ bytes, fileName: picked.name, hash: fileHash(bytes) });
                })
                .catch(() => {
                  setProblem(t("import.error.read"));
                });
            }}
          />
          <p id={helpId} className={cx(styles.muted)}>
            {t("import.fileHelp")}
          </p>
        </div>
        {problem ? (
          <p role="alert" className={cx(styles.error)}>
            {problem}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Le colonne come indici, per le liste di scelta (un profilo le salva per nome). */
function indexRef(ref: ColRef | undefined, headers: readonly string[]): number | null {
  if (!ref) return null;
  const i = columnIndex(ref, headers);
  return i < 0 ? null : i;
}

function ColumnsStep({
  bytes,
  settings,
  onChange,
  onBack,
  onNext,
}: {
  readonly bytes: Uint8Array;
  readonly settings: ImportSettings;
  readonly onChange: (next: ImportSettings) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  const rows = useMemo(() => rawRows(bytes, settings), [bytes, settings]);
  const width = Math.max(0, ...rows.slice(settings.skipRows).map((r) => r.length));
  const header = settings.hasHeader ? (rows[settings.skipRows] ?? []) : [];
  const headers = Array.from({ length: width }, (_, i) => header[i]?.trim() ?? "");
  const label = (i: number) => headers[i] || t("import.column", { n: String(i + 1) });
  const columnOptions: Option[] = headers.map((_, i) => ({ id: String(i), label: label(i) }));
  const optional: Option[] = [{ id: "none", label: t("import.none") }, ...columnOptions];
  const set = (patch: Partial<ImportSettings>) => {
    onChange({ ...settings, ...patch });
  };
  const columns = settings.columns;
  const setColumn = (
    field: "date" | "amount" | "debit" | "credit" | "payee" | "type",
    key: string | null,
  ) => {
    const ref = key === null || key === "none" ? undefined : { index: Number(key) };
    const next = Object.fromEntries(
      Object.entries({ ...columns, [field]: ref }).filter(([, value]) => value !== undefined),
    ) as unknown as ImportSettings["columns"];
    set({ columns: next });
  };
  const description = columns.description.map((ref) => indexRef(ref, headers));
  const pickKey = (ref: ColRef | undefined) => {
    const i = indexRef(ref, headers);
    return i === null ? "none" : String(i);
  };
  const mode = settings.sign.mode;
  const sample = rows.slice(
    settings.skipRows + (settings.hasHeader ? 1 : 0),
    settings.skipRows + (settings.hasHeader ? 6 : 5),
  );

  return (
    <Card title={t("import.step.columns")} as="section">
      <div className={cx(styles.stack)}>
        <div className={cx(local.grid)}>
          <Select
            label={t("import.encoding")}
            options={[
              { id: "utf-8", label: "UTF-8" },
              { id: "windows-1252", label: "Windows-1252" },
              { id: "iso-8859-1", label: "ISO-8859-1" },
            ]}
            value={settings.encoding}
            onChange={(key) => {
              set({ encoding: String(key) as ImportSettings["encoding"] });
            }}
          />
          <Select
            label={t("import.delimiter")}
            options={[
              { id: ";", label: t("import.delimiter.semicolon") },
              { id: ",", label: t("import.delimiter.comma") },
              { id: "\t", label: t("import.delimiter.tab") },
            ]}
            value={settings.delimiter}
            onChange={(key) => {
              set({ delimiter: String(key) as ImportSettings["delimiter"] });
            }}
          />
          <TextField
            label={t("import.skipRows")}
            description={t("import.skipRowsHelp")}
            inputMode="numeric"
            value={String(settings.skipRows)}
            onChange={(text) => {
              const n = Number(text);
              if (Number.isInteger(n) && n >= 0 && n < 100) set({ skipRows: n });
            }}
          />
          <Checkbox
            isSelected={settings.hasHeader}
            onChange={(hasHeader) => {
              set({ hasHeader });
            }}
          >
            {t("import.hasHeader")}
          </Checkbox>
        </div>
        <div className={cx(local.grid)}>
          <Select
            label={t("import.col.date")}
            options={columnOptions}
            value={pickKey(columns.date)}
            onChange={(key) => {
              setColumn("date", key === null ? null : String(key));
            }}
          />
          <Select
            label={t("import.dateFormat")}
            options={DATE_FORMATS.map((f) => ({ id: f, label: f.replace(/y/g, "a").replace(/d/g, "g") }))}
            value={settings.dateFormat}
            onChange={(key) => {
              set({ dateFormat: String(key) });
            }}
          />
          <Select
            label={t("import.col.description")}
            options={columnOptions}
            value={description[0] === null || description[0] === undefined ? null : String(description[0])}
            onChange={(key) => {
              const rest = columns.description.slice(1);
              set({ columns: { ...columns, description: [{ index: Number(key) }, ...rest] } });
            }}
          />
          <Select
            label={t("import.col.description2")}
            options={optional}
            value={description[1] === null || description[1] === undefined ? "none" : String(description[1])}
            onChange={(key) => {
              const first = columns.description[0] ?? { index: 0 };
              set({
                columns: {
                  ...columns,
                  description: key === "none" || key === null ? [first] : [first, { index: Number(key) }],
                },
              });
            }}
          />
          <Select
            label={t("import.col.payee")}
            options={optional}
            value={pickKey(columns.payee)}
            onChange={(key) => {
              setColumn("payee", key === null ? null : String(key));
            }}
          />
        </div>
        <div className={cx(local.grid)}>
          <Select
            label={t("import.sign")}
            options={(
              ["negativeIsExpense", "positiveIsExpense", "debitCreditColumns", "typeColumn"] as const
            ).map((m) => ({
              id: m,
              label: t(`import.sign.${m}`),
            }))}
            value={mode}
            onChange={(key) => {
              set({ sign: { ...settings.sign, mode: String(key) as SignMode } });
            }}
          />
          {mode === "debitCreditColumns" ? (
            <>
              <Select
                label={t("import.col.debit")}
                options={columnOptions}
                value={pickKey(columns.debit)}
                onChange={(key) => {
                  setColumn("debit", key === null ? null : String(key));
                }}
              />
              <Select
                label={t("import.col.credit")}
                options={columnOptions}
                value={pickKey(columns.credit)}
                onChange={(key) => {
                  setColumn("credit", key === null ? null : String(key));
                }}
              />
            </>
          ) : (
            <Select
              label={t("import.col.amount")}
              options={columnOptions}
              value={pickKey(columns.amount)}
              onChange={(key) => {
                setColumn("amount", key === null ? null : String(key));
              }}
            />
          )}
          {mode === "typeColumn" ? (
            <>
              <Select
                label={t("import.col.type")}
                options={columnOptions}
                value={pickKey(columns.type)}
                onChange={(key) => {
                  setColumn("type", key === null ? null : String(key));
                }}
              />
              <TextField
                label={t("import.expenseValues")}
                description={t("import.valuesHelp")}
                value={(settings.sign.expenseValues ?? []).join(", ")}
                onChange={(text) => {
                  set({ sign: { ...settings.sign, expenseValues: splitValues(text) } });
                }}
              />
              <TextField
                label={t("import.incomeValues")}
                description={t("import.valuesHelp")}
                value={(settings.sign.incomeValues ?? []).join(", ")}
                onChange={(text) => {
                  set({ sign: { ...settings.sign, incomeValues: splitValues(text) } });
                }}
              />
            </>
          ) : null}
          <Select
            label={t("import.decimal")}
            options={[
              { id: ",", label: t("import.decimal.comma") },
              { id: ".", label: t("import.decimal.dot") },
            ]}
            value={settings.decimalSeparator}
            onChange={(key) => {
              set({ decimalSeparator: String(key) as ImportSettings["decimalSeparator"] });
            }}
          />
          <Select
            label={t("import.thousands")}
            options={[
              { id: ".", label: t("import.thousands.dot") },
              { id: ",", label: t("import.thousands.comma") },
              { id: " ", label: t("import.thousands.space") },
              { id: "", label: t("import.thousands.none") },
            ]}
            value={settings.thousandsSeparator}
            onChange={(key) => {
              set({ thousandsSeparator: String(key) as ImportSettings["thousandsSeparator"] });
            }}
          />
        </div>
        <SampleTable headers={headers.map((_, i) => label(i))} rows={sample} />
        <div className={cx(styles.actions)}>
          <Button variant="secondary" onPress={onBack}>
            {t("import.back")}
          </Button>
          <Button onPress={onNext}>{t("import.next")}</Button>
        </div>
      </div>
    </Card>
  );
}

function SampleTable({
  headers,
  rows,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly string[][];
}) {
  const columns: DataTableColumn<{ id: string; cells: readonly string[] }>[] = headers.map((h, i) => ({
    id: `c${String(i)}`,
    header: h,
    sortable: false,
    value: (r) => r.cells[i] ?? "",
  }));
  return (
    <div className={cx(local.scroll)}>
      <DataTable
        caption={t("import.sample")}
        columns={columns}
        rows={rows.map((cells, i) => ({ id: String(i), cells }))}
        getRowId={(r) => r.id}
      />
    </div>
  );
}

const STATUS: Record<PlanItem["status"], Status> = {
  new: "good",
  duplicate: "warning",
  transfer: "good",
  error: "critical",
};

async function allPages<T>(
  read: (after?: Cursor) => Promise<{ docs: T[]; next: Cursor | null }>,
): Promise<T[]> {
  const docs: T[] = [];
  let after: Cursor | undefined;
  do {
    const page = await read(after);
    docs.push(...page.docs);
    after = page.next ?? undefined;
  } while (after);
  return docs;
}

function PreviewStep({
  file,
  settings,
  profile,
  accountId,
  batches,
  onColumns,
  onDone,
}: {
  readonly file: Loaded;
  readonly settings: ImportSettings;
  readonly profile: ImportProfile | null;
  readonly accountId: string;
  readonly batches: readonly ImportBatch[];
  readonly onColumns: () => void;
  readonly onDone: (counts: ImportPlan["counts"]) => void;
}) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const { family } = useFamily();
  const accounts = useCollection(family.id, "accounts");
  const categories = useCollection(family.id, "categories");
  const payees = useCollection(family.id, "payees");
  const read = useMemo(
    () => readRows(decodeBytes(file.bytes, settings.encoding), settings),
    [file, settings],
  );
  const range = read.ok ? planWindow(read.value.rows) : null;
  const existing = useTransactionsInRange(family.id, range ?? { from: "0000-01-01", to: "0000-01-01" });
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set());
  const profileChanged = profile !== null && !sameSettings(settingsOf(profile), settings);
  const [saveProfile, setSaveProfile] = useState(profile === null || profileChanged);
  const [name, setName] = useState(profile?.name ?? suggestedName(file.fileName));
  const [confirming, setConfirming] = useState(false);
  const [batchId] = useState(newId);

  const account = accounts.data?.find((a) => a.id === accountId);
  const plan = useMemo(() => {
    if (!read.ok || !account || !accounts.data || !categories.data || !payees.data || !existing.data)
      return null;
    return planImport({
      rows: read.value.rows,
      account,
      accounts: accounts.data,
      family,
      categories: categories.data,
      payees: payees.data,
      existing: existing.data,
      batchId,
      profileId: profile?.id ?? null,
      fileName: file.fileName,
      fileHash: file.hash,
      nowMs: Date.now(),
      newId,
      declinedTransfers: declined,
    });
  }, [
    read,
    account,
    accounts.data,
    categories.data,
    payees.data,
    existing.data,
    family,
    batchId,
    profile,
    file,
    declined,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!plan || !account) return null;
      const keep = saveProfile && name.trim() !== "";
      const profileId = keep ? (profile?.id ?? newId()) : (profile?.id ?? null);
      const doc =
        keep && profileId
          ? profileDoc({ id: profileId, name, accountId: account.id, bytes: file.bytes, settings })
          : null;
      const final = planImport({
        rows: read.ok ? read.value.rows : [],
        account,
        accounts: accounts.data ?? [],
        family,
        categories: categories.data ?? [],
        payees: payees.data ?? [],
        existing: existing.data ?? [],
        batchId,
        profileId,
        fileName: file.fileName,
        fileHash: file.hash,
        nowMs: Date.now(),
        newId,
        declinedTransfers: declined,
        ...(doc ? { profile: doc } : {}),
      });
      for (const chunk of chunkOps<CommitOp>(final.ops)) unwrap(await adapter.commit(family.id, chunk));
      return final.counts;
    },
    onSuccess: async (counts) => {
      await client.invalidateQueries({ queryKey: keys.family(family.id) });
      if (counts) onDone(counts);
    },
  });

  if (!read.ok)
    return (
      <Card title={t("import.step.preview")} as="section">
        <div className={cx(styles.stack)}>
          <p role="alert" className={cx(styles.error)}>
            {t("import.missingColumn", { field: t(`import.col.${read.error.field}` as "import.col.date") })}
          </p>
          <div className={cx(styles.actions)}>
            <Button onPress={onColumns}>{t("import.profileChange")}</Button>
          </div>
        </div>
      </Card>
    );
  if (read.value.rows.length > MAX_ROWS)
    return (
      <p role="alert" className={cx(styles.error)}>
        {t("import.error.rows")}
      </p>
    );
  if (existing.isError || accounts.isError || categories.isError || payees.isError)
    return <ErrorState onRetry={() => void existing.refetch()} />;
  if (!plan || !account) return <Skeleton lines={6} />;

  const sameFile = batches.find((b) => b.fileHash === file.hash);
  const importable = plan.counts.new + plan.counts.transfer;
  const transferItems = planImport({
    rows: read.value.rows,
    account,
    accounts: accounts.data ?? [],
    family,
    categories: categories.data ?? [],
    payees: payees.data ?? [],
    existing: existing.data ?? [],
    batchId,
    profileId: null,
    fileName: file.fileName,
    fileHash: file.hash,
    nowMs: 0,
    newId,
  }).items.filter((i): i is Extract<PlanItem, { status: "transfer" }> => i.status === "transfer");
  const accountName = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      {profile ? (
        <Card as="section">
          <div className={cx(styles.actions)}>
            <StatusBadge status="good" label={t("import.profileFound", { name: profile.name })} />
            <Button size="sm" variant="secondary" onPress={onColumns}>
              {t("import.profileChange")}
            </Button>
          </div>
        </Card>
      ) : null}
      <Card title={t("import.step.preview")} as="section">
        <div className={cx(styles.stack)}>
          <p aria-live="polite">
            {t("import.counts", {
              new: String(plan.counts.new),
              duplicate: String(plan.counts.duplicate),
              transfer: String(plan.counts.transfer),
              error: String(plan.counts.error),
            })}
          </p>
          {sameFile ? (
            <p role="status">
              <StatusBadge
                status="warning"
                label={t("import.alreadyImported", { date: formatDate(new Date(sameFile.importedAtMs)) })}
              />
            </p>
          ) : null}
          {transferItems.length > 0 ? (
            <fieldset className={cx(local.fieldset)}>
              <legend>{t("import.transfers")}</legend>
              <p className={cx(styles.muted)}>{t("import.transfersHelp")}</p>
              {transferItems.map((item) => (
                <Checkbox
                  key={item.fingerprint}
                  isSelected={!declined.has(item.fingerprint)}
                  onChange={(on) => {
                    const next = new Set(declined);
                    if (on) next.delete(item.fingerprint);
                    else next.add(item.fingerprint);
                    setDeclined(next);
                  }}
                >
                  {t("import.transferWith", {
                    amount: amountText(cents(Math.abs(item.row.signedCents))),
                    date: asDate(item.row.date),
                    other: item.other.description || "—",
                    account: accountName(item.other.accountId),
                  })}
                </Checkbox>
              ))}
            </fieldset>
          ) : null}
          <PreviewTable items={plan.items} />
        </div>
      </Card>
      <Card title={profile && !profileChanged ? undefined : t("import.saveProfile")} as="section">
        <div className={cx(styles.form)}>
          {profile === null || profileChanged ? (
            <>
              <Checkbox isSelected={saveProfile} onChange={setSaveProfile}>
                {profile ? t("import.updateProfile", { name: profile.name }) : t("import.saveProfile")}
              </Checkbox>
              {saveProfile ? (
                <TextField
                  label={t("import.profileName")}
                  description={t("import.profileHelp")}
                  value={name}
                  onChange={setName}
                />
              ) : null}
            </>
          ) : null}
          {importable === 0 ? <p className={cx(styles.muted)}>{t("import.nothing")}</p> : null}
          {save.isError ? (
            <p role="alert" className={cx(styles.error)}>
              {t("import.error.save")}
            </p>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button variant="secondary" onPress={onColumns}>
              {t("import.back")}
            </Button>
            <Button
              isDisabled={importable === 0}
              onPress={() => {
                setConfirming(true);
              }}
            >
              {t("import.submit", { count: String(importable) })}
            </Button>
          </div>
        </div>
      </Card>
      {confirming ? (
        <Dialog
          title={t("import.confirm.title")}
          isOpen
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          footer={(close) => (
            <>
              <Button variant="secondary" onPress={close}>
                {t("common.cancel")}
              </Button>
              <Button
                isPending={save.isPending}
                onPress={() => {
                  save.mutate(undefined, {
                    onSettled: () => {
                      setConfirming(false);
                    },
                  });
                }}
              >
                {t("import.confirm.save")}
              </Button>
            </>
          )}
        >
          <p>{t("import.confirm.body", { count: String(importable), account: account.name })}</p>
        </Dialog>
      ) : null}
    </>
  );
}

function PreviewTable({ items }: { readonly items: readonly PlanItem[] }) {
  const columns: DataTableColumn<PlanItem>[] = [
    { id: "line", header: t("import.col.line"), align: "end", value: (i) => i.row.line },
    {
      id: "date",
      header: t("import.col.date"),
      value: (i) => (i.row.ok ? i.row.date : ""),
      cell: (i) => (i.row.ok ? asDate(i.row.date) : ""),
    },
    {
      id: "description",
      header: t("import.col.description"),
      value: (i) => (i.row.ok ? i.row.description : rowErrorText(i.row)),
      cell: (i) =>
        i.row.ok ? i.row.description : <span className={cx(styles.error)}>{rowErrorText(i.row)}</span>,
    },
    {
      id: "amount",
      header: t("import.col.amount"),
      align: "end",
      value: (i) => (i.row.ok ? i.row.signedCents : 0),
      cell: (i) =>
        i.row.ok ? (
          <Amount value={cents(i.row.signedCents)} kind={i.row.signedCents < 0 ? "expense" : "income"} />
        ) : (
          ""
        ),
    },
    {
      id: "status",
      header: t("import.col.status"),
      value: (i) => i.status,
      cell: (i) => <StatusBadge status={STATUS[i.status]} label={statusLabel(i)} />,
    },
  ];
  return (
    <DataTable
      caption={t("import.previewCaption")}
      columns={columns}
      rows={items}
      getRowId={(i) => String(i.row.line)}
    />
  );
}

function ResultStep({
  counts,
  onAgain,
}: {
  readonly counts: ImportPlan["counts"];
  readonly onAgain: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Card title={t("import.done")} as="section">
      <div className={cx(styles.stack)}>
        <p role="status">
          {t("import.result", {
            imported: String(counts.new + counts.transfer),
            duplicate: String(counts.duplicate),
            error: String(counts.error),
          })}
        </p>
        <div className={cx(styles.actions)}>
          <Button onPress={() => void navigate("/movimenti?periodo=tutto")}>{t("import.toRegister")}</Button>
          <Button variant="secondary" onPress={onAgain}>
            {t("import.again")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function HistoryCard({
  batches,
  accountName,
}: {
  readonly batches: readonly ImportBatch[];
  readonly accountName: (id: string) => string;
}) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  const { family } = useFamily();
  const [undoing, setUndoing] = useState<ImportBatch | null>(null);
  const undo = useMutation({
    mutationFn: async (batch: ImportBatch) => {
      const txs = await allPages<Transaction>(async (after) =>
        unwrap(
          await adapter.list(family.id, "transactions", {
            where: { importBatchId: batch.id },
            ...(after ? { after } : {}),
          }),
        ),
      );
      for (const chunk of chunkOps<CommitOp>(undoImportOps(batch, txs)))
        unwrap(await adapter.commit(family.id, chunk));
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.family(family.id) });
      toast.show({ message: t("import.undo.done") });
    },
  });
  const sorted = [...batches].sort((a, b) => b.importedAtMs - a.importedAtMs);
  return (
    <Card title={t("import.history")} as="section">
      {sorted.length === 0 ? (
        <EmptyState title={t("import.historyEmpty")} />
      ) : (
        <ul className={cx(local.list)}>
          {sorted.map((b) => (
            <li key={b.id} className={cx(local.item)}>
              <span>
                {t("import.historyRow", {
                  file: b.fileName,
                  imported: String(b.importedCount),
                  account: accountName(b.accountId),
                  from: asDate(b.dateFrom),
                  to: asDate(b.dateTo),
                })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  setUndoing(b);
                }}
              >
                {t("import.undo")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {undo.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {t("import.undo.error")}
        </p>
      ) : null}
      {undoing ? (
        <ConfirmDialog
          title={t("import.undo.title")}
          message={t("import.undo.body", { count: String(undoing.importedCount), file: undoing.fileName })}
          confirmLabel={t("import.undo")}
          isOpen
          onOpenChange={(open) => {
            if (!open) setUndoing(null);
          }}
          onConfirm={() => {
            undo.mutate(undoing);
          }}
        />
      ) : null}
    </Card>
  );
}
