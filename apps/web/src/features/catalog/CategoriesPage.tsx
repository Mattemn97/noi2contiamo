// Categorie (feature 7): entrate e uscite, un livello di sottocategorie, colore, divisione predefinita salvata.
import { categorySplit, newId, type BasisPoints, type Category, type Member } from "@noi2contiamo/core";
import { useState, type SyntheticEvent } from "react";
import { useCollection } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Tabs,
  TextField,
} from "../../ui";
import { SERIES_SLOTS } from "../../ui/charts/seriesColor";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import list from "./catalog.module.css";
import { ReapplyButton } from "../split/ReapplyButton";
import { SplitEditor, type SplitDraft } from "../split/SplitEditor";
import { ArchiveButton, saveErrorText, useSave } from "./shared";

type Kind = Category["kind"];
const NONE = "none";

/** I colori delle categorie sono gli slot della palette dei grafici (`series-1..8`), mai colori scritti a mano. */
export const CATEGORY_COLORS = Array.from({ length: SERIES_SLOTS }, (_, i) => `series-${i + 1}`);

/** Principali in ordine, ognuna seguita dalle sue sottocategorie. */
export function categoryTree(categories: readonly Category[]): { category: Category; depth: 0 | 1 }[] {
  const byOrder = [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "it"));
  return byOrder
    .filter((c) => c.parentId === null || !categories.some((p) => p.id === c.parentId))
    .flatMap((parent) => [
      { category: parent, depth: 0 as const },
      ...byOrder.filter((c) => c.parentId === parent.id).map((category) => ({ category, depth: 1 as const })),
    ]);
}

/** Etichetta per le liste di scelta: "Principale › Sotto". */
export function categoryLabel(category: Category, all: readonly Category[]): string {
  const parent = all.find((c) => c.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** Quote in punti base → divisione salvabile, solo se sommano a 10000. */
export function splitFromShares(
  shares: Readonly<Record<string, BasisPoints | null>>,
): Category["defaultSplit"] | "invalid" {
  const entries = Object.entries(shares).filter(([, v]) => v !== null && v > 0) as [string, BasisPoints][];
  const sum = entries.reduce((total, [, v]) => total + v, 0);
  if (sum !== 10000) return "invalid";
  return { kind: "bp", shares: Object.fromEntries(entries) };
}

function CategoryForm({
  familyId,
  category,
  kind,
  all,
  members,
  onDone,
}: {
  readonly familyId: string;
  readonly category: Category | null;
  readonly kind: Kind;
  readonly all: readonly Category[];
  readonly members: readonly Member[];
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState<string>(category?.parentId ?? NONE);
  const [color, setColor] = useState<string>(category?.color ?? NONE);
  const [ownSplit, setOwnSplit] = useState(category?.defaultSplit != null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft>(() => ({
    kind: "bp",
    shares: Object.fromEntries(members.map((m) => [m.id, category?.defaultSplit?.shares[m.id] ?? null])),
  }));
  const [problem, setProblem] = useState<"name" | "split" | null>(null);
  const save = useSave(familyId, "categories", onDone);
  const chosenParent = all.find((c) => c.id === parentId);
  const inheritFrom = chosenParent?.defaultSplit ? chosenParent : null;
  const hasChildren = category !== null && all.some((c) => c.parentId === category.id);
  const parents = all.filter(
    (c) =>
      c.kind === kind &&
      c.parentId === null &&
      c.id !== category?.id &&
      (c.archivedAtMs === null || c.id === category?.parentId),
  );

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      setProblem("name");
      return;
    }
    const split = ownSplit ? splitFromShares(splitDraft.shares as Record<string, BasisPoints | null>) : null;
    if (split === "invalid") {
      setProblem("split");
      return;
    }
    setProblem(null);
    save.mutate({
      ...(category ?? { id: newId(), kind, order: all.length, icon: null, archivedAtMs: null }),
      name: name.trim(),
      parentId: parentId === NONE ? null : parentId,
      color: color === NONE ? null : color,
      defaultSplit: split,
    });
  };

  return (
    <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
      <TextField
        label={t("categories.name")}
        isRequired
        value={name}
        onChange={setName}
        isInvalid={problem === "name"}
        errorMessage={t("catalog.error.name")}
      />
      {hasChildren ? null : (
        <Select
          label={t("categories.parent")}
          description={t("categories.parentHelp")}
          options={[
            { id: NONE, label: t("categories.parentNone") },
            ...parents.map((c) => ({ id: c.id, label: c.name })),
          ]}
          value={parentId}
          onChange={(key) => {
            setParentId(key === null ? NONE : String(key));
          }}
        />
      )}
      <Select
        label={t("categories.color")}
        options={[
          { id: NONE, label: t("categories.colorNone") },
          ...CATEGORY_COLORS.map((c, i) => ({ id: c, label: t("categories.colorN", { n: String(i + 1) }) })),
        ]}
        value={color}
        onChange={(key) => {
          setColor(key === null ? NONE : String(key));
        }}
      />
      <fieldset className={cx(styles.stack)}>
        <legend>{t("categories.split")}</legend>
        <SegmentedControl<"family" | "own">
          label={t("categories.split")}
          value={ownSplit ? "own" : "family"}
          onChange={(next) => {
            setOwnSplit(next === "own");
          }}
          options={[
            {
              id: "family",
              label: inheritFrom
                ? t("categories.splitFamilyInherit", { name: inheritFrom.name })
                : t("categories.splitFamily"),
            },
            { id: "own", label: t("categories.splitOwn") },
          ]}
        />
        {ownSplit ? (
          <>
            <p className={cx(styles.muted)}>{t("categories.splitHelp")}</p>
            <SplitEditor members={members} value={splitDraft} onChange={setSplitDraft} />
          </>
        ) : inheritFrom ? (
          <p className={cx(styles.muted)}>{t("categories.splitInheritHelp", { name: inheritFrom.name })}</p>
        ) : null}
      </fieldset>
      {problem === "split" || save.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {problem === "split" ? t("categories.error.split") : saveErrorText(save.error)}
        </p>
      ) : null}
      <div className={cx(styles.actions)}>
        <Button type="submit" isPending={save.isPending}>
          {t("catalog.save")}
        </Button>
        <Button variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function CategoryList({
  kind,
  all,
  showArchived,
  familyId,
  onEdit,
}: {
  readonly kind: Kind;
  readonly all: readonly Category[];
  readonly showArchived: boolean;
  readonly familyId: string;
  readonly onEdit: (category: Category) => void;
}) {
  const rows = categoryTree(all.filter((c) => c.kind === kind)).filter(
    ({ category }) => showArchived || category.archivedAtMs === null,
  );
  if (rows.length === 0) return <EmptyState title={t("categories.empty")} />;
  return (
    <ul className={cx(list.list)}>
      {rows.map(({ category, depth }) => (
        <li key={category.id} className={cx(list.row, depth === 1 && list.child)}>
          <span className={cx(list.name)}>
            {category.color ? (
              <span
                aria-hidden="true"
                className={cx(list.swatch)}
                style={{ background: `var(--${category.color})` }}
              />
            ) : null}
            {category.name}
            {category.archivedAtMs !== null ? (
              <span className={cx(list.meta)}>{t("catalog.archived")}</span>
            ) : null}
          </span>
          <div className={cx(list.end)}>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                onEdit(category);
              }}
            >
              {t("catalog.edit")}
            </Button>
            {category.archivedAtMs === null && categorySplit(category.id, all) ? (
              <ReapplyButton familyId={familyId} categoryId={category.id} />
            ) : null}
            <ArchiveButton familyId={familyId} collection="categories" doc={category} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CategoriesPage() {
  const { family } = useFamily();
  const categories = useCollection(family.id, "categories");
  const members = useCollection(family.id, "members");
  const [kind, setKind] = useState<Kind>("expense");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (categories.isPending || members.isPending) return <Skeleton lines={6} />;
  if (categories.isError || members.isError)
    return <ErrorState onRetry={() => void Promise.all([categories.refetch(), members.refetch()])} />;

  const current = editing === "new" ? null : editing;
  const listFor = (k: Kind) => (
    <CategoryList
      kind={k}
      all={categories.data}
      showArchived={showArchived}
      familyId={family.id}
      onEdit={setEditing}
    />
  );

  return (
    <>
      <PageHeader title={t("categories.title")} subtitle={t("categories.subtitle")} />
      <Card
        actions={
          <Button
            size="sm"
            onPress={() => {
              setEditing("new");
            }}
          >
            {t("categories.add")}
          </Button>
        }
      >
        <div className={cx(styles.stack)}>
          <Checkbox isSelected={showArchived} onChange={setShowArchived}>
            {t("catalog.showArchived")}
          </Checkbox>
          <Tabs
            label={t("categories.kind")}
            selectedKey={kind}
            onSelectionChange={(key) => {
              setKind(key === "income" ? "income" : "expense");
            }}
            items={[
              { id: "expense", label: t("categories.kind.expense"), content: listFor("expense") },
              { id: "income", label: t("categories.kind.income"), content: listFor("income") },
            ]}
          />
        </div>
      </Card>
      <Dialog
        title={t(current ? "categories.editTitle" : "categories.new")}
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <CategoryForm
          key={current?.id ?? `new-${kind}`}
          familyId={family.id}
          category={current}
          kind={current?.kind ?? kind}
          all={categories.data}
          members={members.data.filter((m) => m.leftAtMs === null)}
          onDone={() => {
            setEditing(null);
          }}
        />
      </Dialog>
    </>
  );
}
