// Famiglia e inviti (feature 6): membri e ruoli, persone senza account, inviti con codice o link,
// cambio di famiglia attiva e uscita. Le azioni di gestione si vedono solo al proprietario.
import { checkSplit, newId, type Invite, type Member } from "@noi2contiamo/core";
import type { FamilySummary } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { DataQueryError, keys, unwrap, useCollection, useFamilies } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  TextField,
  formatDate,
  useToast,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import { inviteLink, storeActiveFamily } from "./invite";
import { ReapplyButton } from "../split/ReapplyButton";
import { SplitEditor, type SplitDraft } from "../split/SplitEditor";
import { JoinForm } from "./JoinForm";
import page from "./FamilyPage.module.css";

type Role = Member["role"];

const errorText = (error: unknown): string =>
  error instanceof DataQueryError && error.error.code === "conflict" && error.error.reason === "last_owner"
    ? t("members.error.last_owner")
    : t("members.error.other");

/** Inviti ancora utilizzabili, dal più nuovo. */
export function pendingInvites(invites: readonly Invite[], nowMs: number): Invite[] {
  return invites
    .filter((i) => i.usedAtMs === null && i.revokedAtMs === null && i.expiresAtMs > nowMs)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function useFamilyMutation<T>(fn: (input: T) => Promise<unknown>, onDone?: (input: T) => void) {
  const client = useQueryClient();
  const { family } = useFamily();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({ queryKey: keys.family(family.id) });
      await client.invalidateQueries({ queryKey: keys.families });
      onDone?.(input);
    },
  });
}

function MemberRow({ member, me, isOwner }: { member: Member; me: FamilySummary; isOwner: boolean }) {
  const adapter = useAdapter();
  const toast = useToast();
  const isMe = member.id === me.memberId;
  const change = useFamilyMutation(async (role: Role) => {
    unwrap(await adapter.membership.setMemberRole(me.family.id, member.id, role));
  });
  const remove = useFamilyMutation(
    async () => {
      unwrap(await adapter.membership.removeMember(me.family.id, member.id));
    },
    () => {
      toast.show({ message: t("members.removed", { name: member.displayName }) });
    },
  );
  const failed = change.error ?? remove.error;
  return (
    <li className={cx(page.row)}>
      <div className={cx(page.who)}>
        <span className={cx(page.name)}>
          {member.displayName}
          {isMe ? <span className={cx(styles.muted)}> ({t("members.you")})</span> : null}
        </span>
        <span className={cx(page.badges)}>
          <StatusBadge
            status={member.role === "owner" ? "good" : "warning"}
            label={t(member.role === "owner" ? "members.role.owner" : "members.role.member")}
          />
          {member.userId === null ? <span className={cx(styles.muted)}>{t("members.noAccount")}</span> : null}
        </span>
      </div>
      {isOwner && !isMe ? (
        <div className={cx(styles.actions)}>
          <Button
            size="sm"
            variant="secondary"
            isPending={change.isPending}
            onPress={() => {
              change.mutate(member.role === "owner" ? "member" : "owner");
            }}
          >
            {t(member.role === "owner" ? "members.makeMember" : "members.makeOwner")}
          </Button>
          <ConfirmDialog
            title={t("members.removeTitle", { name: member.displayName })}
            message={t("members.removeBody")}
            confirmLabel={t("members.remove")}
            onConfirm={() => {
              remove.mutate(undefined);
            }}
            trigger={
              <Button size="sm" variant="ghost">
                {t("members.remove")}
              </Button>
            }
          />
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className={cx(styles.error)}>
          {errorText(failed)}
        </p>
      ) : null}
    </li>
  );
}

function AddPlaceholder({ familyId }: { familyId: string }) {
  const adapter = useAdapter();
  const toast = useToast();
  const [name, setName] = useState("");
  const add = useFamilyMutation(
    async (displayName: string) =>
      unwrap(
        await adapter.put(familyId, "members", {
          id: newId(),
          displayName,
          role: "member",
          joinedAtMs: Date.now(),
        }),
      ),
    (displayName) => {
      setName("");
      toast.show({ message: t("members.added", { name: displayName }) });
    },
  );
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() !== "") add.mutate(name.trim());
  };
  return (
    <Card title={t("members.addTitle")} as="section">
      <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
        <p className={cx(styles.muted)}>{t("members.addHelp")}</p>
        <TextField label={t("members.addName")} isRequired value={name} onChange={setName} />
        {add.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("members.error.other")}
          </p>
        ) : null}
        <div className={cx(styles.actions)}>
          <Button type="submit" variant="secondary" isPending={add.isPending}>
            {t("members.add")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function InviteCard({
  familyId,
  members,
  invites,
}: {
  familyId: string;
  members: Member[];
  invites: Invite[];
}) {
  const adapter = useAdapter();
  const toast = useToast();
  const [role, setRole] = useState<Role>("member");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string | null } | null>(null);
  const placeholders = members.filter((m) => m.userId === null);

  const create = useFamilyMutation(async () => {
    const result = unwrap(await adapter.membership.createInvite(familyId, { id: newId(), role, memberId }));
    setCreated({
      token: result.token,
      name: placeholders.find((m) => m.id === memberId)?.displayName ?? null,
    });
  });
  const revoke = useFamilyMutation(
    async (invite: Invite) =>
      unwrap(await adapter.put(familyId, "invites", { ...invite, revokedAtMs: Date.now() })),
    () => {
      toast.show({ message: t("invite.revoked") });
    },
  );
  const link = created ? inviteLink(window.location.origin, created.token) : "";
  const pending = pendingInvites(invites, Date.now());

  return (
    <Card title={t("invite.title")} as="section">
      <div className={cx(styles.stack)}>
        <p className={cx(styles.muted)}>{t("invite.help")}</p>
        <SegmentedControl<Role>
          label={t("invite.role")}
          value={role}
          onChange={setRole}
          options={[
            { id: "member", label: t("members.role.member") },
            { id: "owner", label: t("members.role.owner") },
          ]}
        />
        {placeholders.length > 0 ? (
          <Select
            label={t("members.inviteFor")}
            options={placeholders.map((m) => ({ id: m.id, label: m.displayName }))}
            value={memberId}
            onChange={(key) => {
              setMemberId(key === null ? null : String(key));
            }}
          />
        ) : null}
        <div className={cx(styles.actions)}>
          <Button
            isPending={create.isPending}
            onPress={() => {
              create.mutate(undefined);
            }}
          >
            {t("invite.create")}
          </Button>
        </div>
        {create.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("members.error.other")}
          </p>
        ) : null}
        {created ? (
          <div className={cx(page.created)} aria-live="polite">
            {created.name ? <p>{t("invite.createdFor", { name: created.name })}</p> : null}
            <TextField label={t("invite.code")} isReadOnly value={created.token} />
            <TextField label={t("invite.link")} isReadOnly value={link} />
            <div className={cx(styles.actions)}>
              <Button
                variant="secondary"
                onPress={() => {
                  void navigator.clipboard.writeText(link).then(() => {
                    toast.show({ message: t("invite.copied") });
                  });
                }}
              >
                {t("invite.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        <h3 className={cx(page.subtitle)}>{t("invite.pending")}</h3>
        {pending.length === 0 ? (
          <p className={cx(styles.muted)}>{t("invite.none")}</p>
        ) : (
          <ul className={cx(page.list)}>
            {pending.map((invite) => (
              <li key={invite.id} className={cx(page.row)}>
                <span>
                  {t(invite.role === "owner" ? "members.role.owner" : "members.role.member")} ·{" "}
                  {t("invite.expires", { date: formatDate(new Date(invite.expiresAtMs)) })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    revoke.mutate(invite);
                  }}
                >
                  {t("invite.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function SwitchFamily({ current }: { current: FamilySummary }) {
  const families = useFamilies();
  const client = useQueryClient();
  const navigate = useNavigate();
  return (
    <Card title={t("family.switch")} as="section">
      <div className={cx(styles.stack)}>
        {(families.data?.length ?? 0) > 1 ? (
          <Select
            label={t("family.switchLabel")}
            options={(families.data ?? []).map((f) => ({ id: f.family.id, label: f.family.name }))}
            value={current.family.id}
            onChange={(key) => {
              if (key === null) return;
              storeActiveFamily(String(key));
              void client.invalidateQueries({ queryKey: keys.families }).then(() => navigate("/"));
            }}
          />
        ) : null}
        <h3 className={cx(page.subtitle)}>{t("family.joinOther")}</h3>
        <JoinForm />
      </div>
    </Card>
  );
}

function LeaveCard({ current }: { current: FamilySummary }) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useMutation({
    mutationFn: async () => {
      unwrap(await adapter.membership.leaveFamily(current.family.id));
    },
    onSuccess: async () => {
      client.removeQueries({ queryKey: keys.family(current.family.id) });
      await client.invalidateQueries({ queryKey: keys.families });
      toast.show({ message: t("family.left") });
      await navigate("/", { replace: true });
    },
  });
  return (
    <Card title={t("family.leave")} as="section">
      <div className={cx(styles.stack)}>
        <p className={cx(styles.muted)}>{t("family.leaveHelp")}</p>
        {leave.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {errorText(leave.error)}
          </p>
        ) : null}
        <div className={cx(styles.actions)}>
          <ConfirmDialog
            title={t("family.leaveTitle", { name: current.family.name })}
            message={t("family.leaveHelp")}
            confirmLabel={t("family.leaveConfirm")}
            onConfirm={() => {
              leave.mutate();
            }}
            trigger={
              <Button variant="danger" isPending={leave.isPending}>
                {t("family.leave")}
              </Button>
            }
          />
        </div>
      </div>
    </Card>
  );
}

/** Divisione predefinita della famiglia (spec 0004, AC-7): ogni membro attivo la cambia. */
function DefaultSplitCard({ current, active }: { current: FamilySummary; active: readonly Member[] }) {
  const adapter = useAdapter();
  const toast = useToast();
  const familyId = current.family.id;
  const [draft, setDraft] = useState<SplitDraft>(() => ({
    kind: "bp",
    shares: Object.fromEntries(active.map((m) => [m.id, current.family.defaultSplit.shares[m.id] ?? null])),
  }));
  const [invalid, setInvalid] = useState(false);
  const save = useFamilyMutation(
    async (split: { kind: "bp"; shares: Record<string, number> }) => {
      unwrap(await adapter.membership.setDefaultSplit(familyId, split));
    },
    () => {
      toast.show({ message: t("family.split.saved") });
    },
  );
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    const checked = checkSplit(draft, 0);
    if (!checked.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({ kind: "bp", shares: checked.value.shares });
  };
  return (
    <Card title={t("family.split.title")} as="section">
      <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
        <p className={cx(styles.muted)}>{t("family.split.help")}</p>
        <SplitEditor members={active} value={draft} onChange={setDraft} />
        {invalid || save.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("family.split.error")}
          </p>
        ) : null}
        <div className={cx(styles.actions)}>
          <Button type="submit" isPending={save.isPending}>
            {t("family.split.save")}
          </Button>
          <ReapplyButton familyId={familyId} />
        </div>
      </form>
    </Card>
  );
}

export function FamilyPage() {
  const me = useFamily();
  const members = useCollection(me.family.id, "members");
  const invites = useCollection(me.family.id, "invites");
  if (members.isPending || invites.isPending) return <Skeleton lines={6} />;
  if (members.isError || invites.isError)
    return <ErrorState onRetry={() => void Promise.all([members.refetch(), invites.refetch()])} />;
  const active = members.data.filter((m) => m.leftAtMs === null);
  const isOwner = me.role === "owner";
  return (
    <>
      <PageHeader title={t("members.title")} subtitle={me.family.name} />
      <div className={cx(styles.stack)}>
        <Card title={t("members.list")} as="section">
          <ul className={cx(page.list)}>
            {active.map((member) => (
              <MemberRow key={member.id} member={member} me={me} isOwner={isOwner} />
            ))}
          </ul>
        </Card>
        <DefaultSplitCard current={me} active={active} />
        {isOwner ? <InviteCard familyId={me.family.id} members={active} invites={invites.data} /> : null}
        {isOwner ? <AddPlaceholder familyId={me.family.id} /> : null}
        <SwitchFamily current={me} />
        <LeaveCard current={me} />
      </div>
    </>
  );
}
