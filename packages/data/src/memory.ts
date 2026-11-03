import {
  buildExport,
  checkCategory,
  checkTransaction,
  COLLECTION_NAMES,
  COLLECTIONS,
  err,
  familySchema,
  familySplitIssues,
  newId,
  nameTaken,
  ok,
  parseDoc,
  readExport,
  zodIssues,
  type Account,
  type Category,
  type CollectionName,
  type DocOf,
  type Family,
  type Member,
  type Payee,
  type Result,
  type Transaction,
} from "@noi2contiamo/core";
import {
  AuthError,
  MAX_COMMIT_OPS,
  MAX_LIST_LIMIT,
  type AuthApi,
  type CommitOp,
  type Cursor,
  type DataAdapter,
  type DataError,
  type FamilyId,
  type InviteError,
  type MembershipApi,
  type Page,
  type User,
} from "./index";
import { INVITE_TTL_MS, inviteToken } from "./token";

type AnyDoc = Record<string, unknown> & { id: string };
type Docs = Record<CollectionName, Map<string, AnyDoc>>;
interface FamilyState {
  family: Family;
  docs: Docs;
}
/** Chi firma una scrittura: basta id e ruolo del membro. */
type Signer = Pick<Member, "id" | "role"> & { readonly joining?: true };
interface Actor {
  readonly member: Member;
  readonly user: User;
}
type R<T> = Result<T, DataError>;


const emptyDocs = (): Docs =>
  Object.fromEntries(COLLECTION_NAMES.map((name) => [name, new Map<string, AnyDoc>()])) as Docs;

const notFound: { ok: false; error: DataError } = err({ code: "not_found" });
const forbidden: { ok: false; error: DataError } = err({ code: "forbidden" });
const conflict = (reason: Extract<DataError, { code: "conflict" }>["reason"]) =>
  err<DataError>({ code: "conflict", reason });

const activeMembers = (fs: FamilyState) =>
  [...fs.docs.members.values()].map((d) => d as unknown as Member).filter((m) => m.leftAtMs === null);

/** Chi legge cosa (stesse regole di Firestore e del server, spec 0002 Security model). */
function canRead(collection: CollectionName, doc: AnyDoc, me: Signer): boolean {
  switch (collection) {
    case "accounts":
    case "transactions":
      return doc.visibility === "shared" || doc.ownerMemberId === me.id;
    case "memberSettings":
      return doc.id === me.id;
    case "reminders":
      return doc.memberId === me.id;
    default:
      return true;
  }
}

function canWrite(collection: CollectionName, next: AnyDoc, prev: AnyDoc | undefined, me: Signer): boolean {
  if (!canRead(collection, next, me) || (prev && !canRead(collection, prev, me))) return false;
  if (collection === "invites") {
    // Su un invito esistente il proprietario può solo revocare: uso e scadenza non si riscrivono.
    const fixed = ["role", "memberId", "expiresAtMs", "usedAtMs", "usedByUserId"] as const;
    return me.role === "owner" && (prev === undefined || me.joining === true || fixed.every((k) => next[k] === prev[k]));
  }
  if (collection === "members") {
    if (me.role === "owner") return true;
    // Un membro modifica solo sé stesso, senza toccare ruolo, account e uscita.
    return (
      prev !== undefined &&
      next.id === me.id &&
      next.role === prev.role &&
      next.userId === prev.userId &&
      next.leftAtMs === prev.leftAtMs
    );
  }
  return true;
}

const dateOf = (d: AnyDoc | Cursor): string => (typeof d.date === "string" ? d.date : "");

function compareFor(orderBy: string): (a: AnyDoc | Cursor, b: AnyDoc | Cursor) => number {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (orderBy === "date_desc")
    return (a, b) => {
      const [da, db] = [dateOf(a), dateOf(b)];
      return da === db ? -byId(a, b) : da < db ? 1 : -1;
    };
  if (orderBy === "order_asc")
    return (a, b) => {
      const [oa, ob] = [Number(a.order ?? 0), Number(b.order ?? 0)];
      return oa === ob ? byId(a, b) : oa - ob;
    };
  return byId;
}

const cursorOf = (doc: AnyDoc, orderBy: string): Cursor =>
  orderBy === "date_desc"
    ? { id: doc.id, date: dateOf(doc) }
    : orderBy === "order_asc"
      ? { id: doc.id, order: Number(doc.order) }
      : { id: doc.id };

/** Adapter in memoria, per test e demo (le password restano in RAM, mai su disco). */
export function createMemoryAdapter(options: { now?: () => number } = {}): DataAdapter {
  const now = options.now ?? (() => Date.now());
  const families = new Map<FamilyId, FamilyState>();
  const tokens = new Map<string, { familyId: FamilyId; inviteId: string }>();
  /** Membri importati da reclamare: `familyId/memberId` → email dell'export. */
  const claims = new Map<string, string>();
  const users = new Map<string, { user: User; password: string }>();
  const listeners = new Set<(user: User | null) => void>();
  let current: User | null = null;

  const setCurrent = (user: User | null) => {
    current = user;
    for (const listener of listeners) listener(user);
  };

  const auth: AuthApi = {
    async signUp(rawEmail, password) {
      const email = rawEmail.trim().toLowerCase();
      if (users.has(email)) throw new AuthError("email_taken", "Email già registrata");
      const user: User = { id: newId(), email };
      users.set(email, { user, password });
      setCurrent(user);
      return user;
    },
    async signIn(rawEmail, password) {
      const entry = users.get(rawEmail.trim().toLowerCase());
      if (!entry || entry.password !== password) throw new AuthError("invalid_credentials", "Credenziali non valide");
      setCurrent(entry.user);
      return entry.user;
    },
    async signOut() {
      setCurrent(null);
    },
    async currentUser() {
      return current;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const actorIn = (fs: FamilyState | undefined): R<Actor> => {
    if (!current) return err({ code: "unauthenticated" });
    const user = current;
    const member = fs && activeMembers(fs).find((m) => m.userId === user.id);
    return member ? ok({ member, user }) : notFound;
  };

  /** Scrive un documento su `fs` (che può essere una bozza di commit): audit, schema, invarianti, unicità. */
  function applyPut(fs: FamilyState, collection: CollectionName, input: object, me: Signer): R<AnyDoc> {
    const raw = input as Partial<AnyDoc>;
    if (typeof raw.id !== "string") return err({ code: "invalid", issues: [{ path: "id", message: "manca l'id" }] });
    const bucket = fs.docs[collection];
    const prev = bucket.get(raw.id);
    const t = now();
    const parsed = parseDoc(collection, {
      ...input,
      createdAtMs: prev?.createdAtMs ?? t,
      createdByMemberId: prev?.createdByMemberId ?? me.id,
      updatedAtMs: t,
      updatedByMemberId: me.id,
    });
    if (!parsed.ok) return err({ code: "invalid", issues: parsed.error });
    const doc = parsed.value as AnyDoc;
    if (!canWrite(collection, doc, prev, me)) return prev && !canRead(collection, prev, me) ? notFound : forbidden;

    const others = [...bucket.values()].filter((d) => d.id !== doc.id);
    if (collection === "transactions") {
      const tx = doc as unknown as Transaction;
      const account = (id: string | null) => (id ? ((fs.docs.accounts.get(id) as Account | undefined) ?? null) : null);
      const checked = checkTransaction(tx, {
        account: account(tx.accountId),
        toAccount: account(tx.toAccountId),
        category: tx.categoryId ? ((fs.docs.categories.get(tx.categoryId) as Category | undefined) ?? null) : null,
        memberIds: new Set(fs.docs.members.keys()),
        payee: tx.payeeId ? ((fs.docs.payees.get(tx.payeeId) as Payee | undefined) ?? null) : null,
      });
      if (!checked.ok)
        return err({ code: "invalid", issues: checked.error.map((message) => ({ path: "", message })) });
      const taken = new Set(others.flatMap((d) => (d as unknown as Transaction).importFingerprints));
      if (tx.importFingerprints.some((f) => taken.has(f))) return conflict("duplicate_fingerprint");
    }
    if (collection === "payees" && others.some((d) => d.normalizedName === doc.normalizedName))
      return conflict("duplicate");
    if ((collection === "accounts" || collection === "categories") && nameTaken(collection, doc as never, others as never))
      return conflict("duplicate");
    if (collection === "categories") {
      const checked = checkCategory(doc as unknown as Category, [...others, doc] as unknown as Category[]);
      if (!checked.ok) return err({ code: "invalid", issues: checked.error.map((message) => ({ path: "parentId", message })) });
    }
    if (collection === "reminders" && others.some((d) => d.dedupKey === doc.dedupKey)) return conflict("duplicate");
    if (collection === "members") {
      if (doc.userId !== null && others.some((d) => d.userId === doc.userId)) return conflict("already_member");
      const owners = [...others, doc].filter((d) => d.role === "owner" && d.leftAtMs === null);
      if (owners.length === 0) return conflict("last_owner");
    }
    bucket.set(doc.id, doc);
    return ok(doc);
  }

  function applyRemove(fs: FamilyState, collection: CollectionName, id: string, me: Signer): R<void> {
    const prev = fs.docs[collection].get(id);
    if (!prev || !canRead(collection, prev, me)) return notFound;
    if (collection === "members") return forbidden; // chi esce resta: si usa leftAtMs
    if (!canWrite(collection, prev, prev, me)) return forbidden;
    const txs = [...fs.docs.transactions.values()];
    const used =
      (collection === "accounts" && txs.some((t) => t.accountId === id || t.toAccountId === id)) ||
      (collection === "categories" &&
        (txs.some((t) => t.categoryId === id) || [...fs.docs.categories.values()].some((c) => c.parentId === id))) ||
      (collection === "payees" && txs.some((t) => t.payeeId === id)) ||
      // Import (spec 0006): un lotto con movimenti, un profilo con lotti, un conto con lotti o profili.
      (collection === "importBatches" && txs.some((t) => t.importBatchId === id)) ||
      (collection === "importProfiles" && [...fs.docs.importBatches.values()].some((b) => b.profileId === id)) ||
      (collection === "accounts" &&
        ([...fs.docs.importBatches.values()].some((b) => b.accountId === id) ||
          [...fs.docs.importProfiles.values()].some((p) => p.defaultAccountId === id)));
    if (used) return conflict("in_use");
    fs.docs[collection].delete(id);
    return ok(undefined);
  }

  const draftOf = (fs: FamilyState): FamilyState => structuredClone(fs);
  const read = <C extends CollectionName>(collection: C, doc: AnyDoc): DocOf<C> => {
    const parsed = parseDoc(collection, doc);
    if (!parsed.ok) throw new Error(`Documento salvato non valido in ${collection}/${doc.id}`);
    return parsed.value;
  };

  function updateMember(familyId: FamilyId, memberId: string, patch: object): R<void> {
    const fs = families.get(familyId);
    const actor = actorIn(fs);
    if (!actor.ok || !fs) return actor.ok ? notFound : actor;
    const target = fs.docs.members.get(memberId);
    if (!target) return notFound;
    if (actor.value.member.role !== "owner") return forbidden;
    const written = applyPut(fs, "members", { ...target, ...patch }, actor.value.member);
    return written.ok ? ok(undefined) : written;
  }

  const membership: MembershipApi = {
    async myFamilies() {
      if (!current) return err({ code: "unauthenticated" });
      const user = current;
      return ok(
        [...families.values()].flatMap((fs) => {
          const member = activeMembers(fs).find((m) => m.userId === user.id);
          return member ? [{ family: structuredClone(fs.family), memberId: member.id, role: member.role }] : [];
        }),
      );
    },

    async createFamily(input) {
      if (!current) return err({ code: "unauthenticated" });
      if (families.has(input.family.id)) return conflict("duplicate");
      const t = now();
      const ownerId = input.ownerMember.id;
      const audit = { createdAtMs: t, createdByMemberId: ownerId, updatedAtMs: t, updatedByMemberId: ownerId };
      const family = familySchema.safeParse({
        defaultSplit: { kind: "bp", shares: { [ownerId]: 10000 } },
        ...input.family,
        createdByUserId: current.id,
        ...audit,
      });
      if (!family.success) return err({ code: "invalid", issues: zodIssues(family.error) });
      const member = parseDoc("members", {
        ...input.ownerMember,
        userId: current.id,
        role: "owner",
        joinedAtMs: t,
        ...audit,
      });
      if (!member.ok) return err({ code: "invalid", issues: member.error });
      const fs: FamilyState = { family: family.data, docs: emptyDocs() };
      fs.docs.members.set(ownerId, member.value);
      for (const category of input.defaults?.categories ?? []) {
        const written = applyPut(fs, "categories", category, member.value);
        if (!written.ok) return written;
      }
      families.set(family.data.id, fs);
      return ok(family.data.id);
    },

    async createInvite(familyId, invite) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      if (actor.value.member.role !== "owner") return forbidden;
      if (invite.memberId) {
        const target = fs.docs.members.get(invite.memberId);
        if (!target || target.userId !== null) return err({ code: "invalid", issues: [{ path: "memberId", message: "serve un membro senza account" }] });
      }
      const written = applyPut(
        fs,
        "invites",
        { ...invite, expiresAtMs: invite.expiresAtMs ?? now() + INVITE_TTL_MS },
        actor.value.member,
      );
      if (!written.ok) return written;
      const token = inviteToken();
      tokens.set(token, { familyId, inviteId: invite.id });
      return ok({ token });
    },

    async acceptInvite(token, displayName): Promise<Result<FamilyId, InviteError>> {
      if (!current) return err({ code: "unauthenticated" });
      const user = current;
      const ref = tokens.get(token);
      const fs = ref && families.get(ref.familyId);
      const invite = ref && fs?.docs.invites.get(ref.inviteId);
      if (!ref || !fs || !invite) return err({ code: "not_found" });
      if (invite.revokedAtMs !== null) return err({ code: "revoked" });
      if (invite.usedAtMs !== null) return err({ code: "used" });
      const t = now();
      if (Number(invite.expiresAtMs) <= t) return err({ code: "expired" });
      if (activeMembers(fs).some((m) => m.userId === user.id)) return conflict("already_member");

      const draft = draftOf(fs);
      const placeholder = typeof invite.memberId === "string" ? draft.docs.members.get(invite.memberId) : undefined;
      // Chi era già uscito rientra con lo stesso membro (un account ha al massimo un membro per famiglia).
      const former = [...draft.docs.members.values()].find((m) => m.userId === user.id);
      const base = former
        ? { ...former, role: invite.role, joinedAtMs: t }
        : (placeholder ?? { id: newId(), displayName, role: invite.role, joinedAtMs: t });
      // Il nuovo membro firma da sé il proprio ingresso; il token valido vale come permesso del proprietario.
      const signer: Signer = { id: base.id, role: "owner", joining: true };
      const written = applyPut(draft, "members", { ...base, userId: user.id, leftAtMs: null }, signer);
      if (!written.ok) return written;
      const used = applyPut(draft, "invites", { ...invite, usedAtMs: t, usedByUserId: user.id }, signer);
      if (!used.ok) return used;
      families.set(ref.familyId, draft);
      return ok(ref.familyId);
    },

    async leaveFamily(familyId) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      const me = actor.value.member;
      const written = applyPut(fs, "members", { ...me, leftAtMs: now() }, { id: me.id, role: "owner" });
      return written.ok ? ok(undefined) : written;
    },

    async setMemberRole(familyId, memberId, role) {
      return updateMember(familyId, memberId, { role });
    },

    async removeMember(familyId, memberId) {
      return updateMember(familyId, memberId, { leftAtMs: now() });
    },

    async setDefaultSplit(familyId, split) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      const issues = familySplitIssues(split, new Set(activeMembers(fs).map((m) => m.id)));
      if (issues.length > 0)
        return err({ code: "invalid", issues: issues.map((message) => ({ path: "defaultSplit", message })) });
      fs.family = {
        ...fs.family,
        defaultSplit: structuredClone(split),
        updatedAtMs: now(),
        updatedByMemberId: actor.value.member.id,
      };
      return ok(undefined);
    },

    async claimMember(familyId, memberId) {
      if (!current) return err({ code: "unauthenticated" });
      const user = current;
      const fs = families.get(familyId);
      const member = fs?.docs.members.get(memberId) as Member | undefined;
      const email = claims.get(`${familyId}/${memberId}`);
      if (!fs || !member || member.userId !== null || email !== user.email) return notFound;
      if (activeMembers(fs).some((m) => m.userId === user.id)) return conflict("already_member");
      fs.docs.members.set(memberId, { ...(member as unknown as AnyDoc), userId: user.id });
      claims.delete(`${familyId}/${memberId}`);
      return ok(undefined);
    },

    async exportFamily(familyId) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      if (actor.value.member.role !== "owner") return forbidden;
      const byId = new Map([...users.values()].map(({ user }) => [user.id, user]));
      const members = [...fs.docs.members.values()] as unknown as Member[];
      const exportUsers = members.flatMap((m) => {
        const user = m.userId ? byId.get(m.userId) : undefined;
        return user ? [{ userId: user.id, email: user.email, displayName: m.displayName }] : [];
      });
      const collections = Object.fromEntries(
        COLLECTION_NAMES.map((name) => [name, [...fs.docs[name].values()].map((d) => read(name, d))]),
      ) as unknown as Parameters<typeof buildExport>[0]["collections"];
      return ok(
        buildExport({
          exportedAtMs: now(),
          sourceBackend: "memory",
          family: structuredClone(fs.family),
          users: exportUsers,
          collections,
        }),
      );
    },

    async importFamily(file) {
      if (!current) return err({ code: "unauthenticated" });
      const parsed = readExport(file);
      if (!parsed.ok) return err({ code: "invalid", issues: parsed.error });
      const { family, collections } = parsed.value;
      if (families.has(family.id)) return conflict("duplicate");
      const emails = new Map(file.users.map((u) => [u.userId, u.email.toLowerCase()]));
      const fs: FamilyState = { family, docs: emptyDocs() };
      for (const name of COLLECTION_NAMES)
        for (const doc of collections[name]) fs.docs[name].set(doc.id, doc);
      for (const original of file.collections.members) {
        const email = original.userId ? emails.get(original.userId) : undefined;
        if (email) claims.set(`${family.id}/${original.id}`, email);
      }
      families.set(family.id, fs);
      return ok(family.id);
    },
  };

  return {
    kind: "memory",
    auth,
    membership,

    async list(familyId, collection, query = {}) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      const def = COLLECTIONS[collection];
      const q = query as {
        where?: Record<string, unknown>;
        orderBy?: string;
        limit?: number;
        after?: Cursor;
        dateFrom?: string;
        dateTo?: string;
        scope?: "shared" | "mine";
      };
      const limit = q.limit ?? MAX_LIST_LIMIT;
      const orderBy = q.orderBy ?? def.orderBy[0];
      const invalid = (message: string) => err<DataError>({ code: "invalid_query", message });
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) return invalid("limit fuori da 1..500");
      if (!(def.orderBy as readonly string[]).includes(orderBy)) return invalid(`orderBy ${orderBy} non ammesso`);
      const bad = Object.keys(q.where ?? {}).find((f) => !(def.indexed as readonly string[]).includes(f));
      if (bad) return invalid(`campo ${bad} non indicizzato`);
      if (!def.hasDate && (q.dateFrom !== undefined || q.dateTo !== undefined)) return invalid("niente date qui");
      if (!def.scoped && q.scope !== undefined) return invalid("scope solo per conti e movimenti");

      const me = actor.value.member;
      const compare = compareFor(orderBy);
      const docs = [...fs.docs[collection].values()]
        .filter((d) => canRead(collection, d, me))
        .filter((d) => q.scope !== "shared" || d.visibility === "shared")
        .filter((d) => q.scope !== "mine" || (d.visibility === "private" && d.ownerMemberId === me.id))
        .filter((d) => Object.entries(q.where ?? {}).every(([field, value]) => d[field] === value))
        .filter((d) => q.dateFrom === undefined || dateOf(d) >= q.dateFrom)
        .filter((d) => q.dateTo === undefined || dateOf(d) <= q.dateTo)
        .filter((d) => q.after === undefined || compare(d, q.after) > 0)
        .sort(compare);
      const pageDocs = docs.slice(0, limit);
      const last = pageDocs.at(-1);
      const page: Page<typeof collection> = {
        docs: pageDocs.map((d) => read(collection, d)),
        next: docs.length > limit && last ? cursorOf(last, orderBy) : null,
      };
      return ok(page);
    },

    async get(familyId, collection, id) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      const doc = fs.docs[collection].get(id);
      return doc && canRead(collection, doc, actor.value.member) ? ok(read(collection, doc)) : notFound;
    },

    async put(familyId, collection, doc) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      const written = applyPut(fs, collection, doc, actor.value.member);
      return written.ok ? ok(read(collection, written.value)) : written;
    },

    async remove(familyId, collection, id) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      return applyRemove(fs, collection, id, actor.value.member);
    },

    async commit(familyId, ops: readonly CommitOp[]) {
      const fs = families.get(familyId);
      const actor = actorIn(fs);
      if (!actor.ok || !fs) return actor.ok ? notFound : actor;
      if (ops.length > MAX_COMMIT_OPS)
        return err({ code: "invalid", issues: [{ path: "ops", message: "massimo 500 operazioni" }] });
      // Si lavora su una bozza: se un'operazione fallisce non si scrive niente.
      const draft = draftOf(fs);
      for (const op of ops) {
        const result =
          op.type === "put"
            ? applyPut(draft, op.collection, op.doc, actor.value.member)
            : applyRemove(draft, op.collection, op.id, actor.value.member);
        if (!result.ok) return result;
      }
      families.set(familyId, draft);
      return ok(undefined);
    },
  };
}
