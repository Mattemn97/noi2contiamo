// Adapter verso Firebase (piano Spark): Authentication con email e password, Firestore con le regole
// di `firebase/firestore.rules` (spec 0002). Le regole fanno da server: qui si preparano documenti
// che le rispettano (audit, accesso, visibilità) e si traducono i rifiuti in `DataError`.
//
// NON VERIFICATO sull'emulatore (serve Java 21; vale anche per inviti e membri del feature 6): vedi `src/contract/firebase.test.ts`.
import {
  checkCategory,
  checkTransaction,
  nameTaken,
  COLLECTIONS,
  err,
  ok,
  parseDoc,
  zodIssues,
  familySchema,
  familySplitIssues,
  type Account,
  type Category,
  type CollectionName,
  newId,
  type DocOf,
  type Invite,
  type Member,
  type Payee,
  type Result,
  type Transaction,
} from "@noi2contiamo/core";
import { FirebaseError, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  collection as coll,
  collectionGroup,
  connectFirestoreEmulator,
  doc,
  documentId,
  getDoc,
  getDocs,
  initializeFirestore,
  limit as qLimit,
  orderBy as qOrderBy,
  query as fsQuery,
  startAfter,
  where as fsWhere,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type WriteBatch,
} from "firebase/firestore";
import {
  AuthError,
  MAX_COMMIT_OPS,
  MAX_LIST_LIMIT,
  type CommitOp,
  type Cursor,
  type DataAdapter,
  type DataError,
  type InviteError,
  type MembershipApi,
  type Page,
  type User,
} from "./index";
import { INVITE_TTL_MS, inviteToken } from "./token";

export interface FirebaseAdapterOptions {
  readonly app: FirebaseOptions;
  /** Nome dell'app Firebase: serve per avere più adapter nello stesso processo (test). */
  readonly name?: string;
  readonly emulator?: { readonly authUrl: string; readonly firestoreHost: string; readonly firestorePort: number };
}

type AnyDoc = Record<string, unknown> & { id: string };
type R<T> = Result<T, DataError>;
interface TokenDoc {
  readonly familyId: string;
  readonly inviteId: string;
  readonly expiresAtMs: number;
  readonly usedByUserId: string | null;
  readonly role: "owner" | "member";
  readonly memberId: string | null;
}
interface Access {
  readonly memberId: string;
  readonly role: "owner" | "member";
}

const notFound = err<DataError>({ code: "not_found" });

const userOf = (u: FirebaseUser): User => ({ id: u.uid, email: u.email ?? "" });

/** Rifiuto delle regole o del server → `DataError`. */
function failure(error: unknown, denied: DataError = { code: "forbidden" }): { ok: false; error: DataError } {
  if (error instanceof FirebaseError) {
    if (error.code === "permission-denied") return err(denied);
    if (error.code === "unauthenticated") return err({ code: "unauthenticated" });
    if (error.code === "not-found") return notFound;
  }
  throw error;
}

function authFailure(error: unknown): AuthError {
  const code = error instanceof FirebaseError ? error.code : "";
  if (code === "auth/email-already-in-use") return new AuthError("email_taken");
  if (code === "auth/weak-password") return new AuthError("weak_password");
  if (code === "auth/invalid-email") return new AuthError("invalid_email");
  if (code.startsWith("auth/invalid-credential") || code === "auth/wrong-password" || code === "auth/user-not-found")
    return new AuthError("invalid_credentials");
  return new AuthError("unavailable", code || String(error));
}

const withoutUndefined = (value: object): DocumentData =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

export function createFirebaseAdapter(options: FirebaseAdapterOptions): DataAdapter {
  const app = initializeApp(options.app, options.name);
  const auth = getAuth(app);
  const db: Firestore = initializeFirestore(app, { ignoreUndefinedProperties: true });
  if (options.emulator) {
    connectAuthEmulator(auth, options.emulator.authUrl, { disableWarnings: true });
    connectFirestoreEmulator(db, options.emulator.firestoreHost, options.emulator.firestorePort);
  }

  const familyRef = (f: string) => doc(db, "families", f);
  const docRef = (f: string, c: CollectionName, id: string) => doc(db, "families", f, c, id);

  async function accessOf(familyId: string): Promise<R<Access>> {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return err({ code: "unauthenticated" });
    try {
      const snap = await getDoc(doc(db, "families", familyId, "access", user.uid));
      return snap.exists() ? ok(snap.data() as Access) : notFound;
    } catch (error) {
      return failure(error, { code: "not_found" });
    }
  }

  async function readDoc(familyId: string, c: CollectionName, id: string): Promise<AnyDoc | null> {
    try {
      const snap = await getDoc(docRef(familyId, c, id));
      return snap.exists() ? ({ ...snap.data(), id: snap.id }) : null;
    } catch (error) {
      // Le regole rifiutano la lettura dei documenti privati di altri: per chi legge non esistono.
      if (error instanceof FirebaseError && error.code === "permission-denied") return null;
      throw error;
    }
  }

  /** Prepara il documento da scrivere: audit, default e invarianti di `core` (le regole non li calcolano). */
  async function prepare(familyId: string, c: CollectionName, input: object, me: Access): Promise<R<AnyDoc>> {
    const raw = input as Partial<AnyDoc>;
    if (typeof raw.id !== "string") return err({ code: "invalid", issues: [{ path: "id", message: "manca l'id" }] });
    const prev = await readDoc(familyId, c, raw.id);
    const t = Date.now();
    const parsed = parseDoc(c, {
      ...input,
      createdAtMs: prev?.createdAtMs ?? t,
      createdByMemberId: prev?.createdByMemberId ?? me.memberId,
      updatedAtMs: t,
      updatedByMemberId: me.memberId,
    });
    if (!parsed.ok) return err({ code: "invalid", issues: parsed.error });
    const next = parsed.value as AnyDoc;
    if (c === "transactions") {
      const tx = next as unknown as Transaction;
      const account = async (id: string | null) =>
        id ? ((await readDoc(familyId, "accounts", id)) as Account | null) : null;
      const category = tx.categoryId ? ((await readDoc(familyId, "categories", tx.categoryId)) as Category | null) : null;
      const members = await getDocs(coll(db, "families", familyId, "members"));
      const checked = checkTransaction(tx, {
        account: await account(tx.accountId),
        toAccount: await account(tx.toAccountId),
        category,
        memberIds: new Set(members.docs.map((d) => d.id)),
        payee: tx.payeeId ? ((await readDoc(familyId, "payees", tx.payeeId)) as Payee | null) : null,
      });
      if (!checked.ok) return err({ code: "invalid", issues: checked.error.map((message) => ({ path: "", message })) });
    }
    if (c === "accounts" || c === "categories" || c === "payees") {
      // Nomi unici e un solo livello di categorie: le regole non leggono le altre righe, lo fa l'adapter.
      const others: AnyDoc[] = [];
      for (const scope of scopes(c, undefined, me)) {
        const snap = await getDocs(fsQuery(coll(db, "families", familyId, c), ...scope));
        others.push(...snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((d) => d.id !== next.id));
      }
      const duplicate =
        c === "payees"
          ? others.some((d) => d.normalizedName === next.normalizedName)
          : nameTaken(c, next as never, others as never);
      if (duplicate) return err({ code: "conflict", reason: "duplicate" });
      if (c === "categories") {
        const checked = checkCategory(next as unknown as Category, [...others, next] as unknown as Category[]);
        if (!checked.ok)
          return err({ code: "invalid", issues: checked.error.map((message) => ({ path: "parentId", message })) });
      }
    }
    return ok(next);
  }

  /** Movimenti e conti: le regole vogliono sempre il vincolo di visibilità nella query. */
  function scopes(c: CollectionName, scope: string | undefined, me: Access): QueryConstraint[][] {
    if (!COLLECTIONS[c].scoped) return [[]];
    const shared = [fsWhere("visibility", "==", "shared")];
    const mine = [fsWhere("ownerMemberId", "==", me.memberId), fsWhere("visibility", "==", "private")];
    if (scope === "shared") return [shared];
    if (scope === "mine") return [mine];
    return [shared, mine];
  }

  const compareFor = (orderBy: string) => (a: AnyDoc, b: AnyDoc) => {
    const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (orderBy === "date_desc") return a.date === b.date ? -byId : String(a.date) < String(b.date) ? 1 : -1;
    if (orderBy === "order_asc") return a.order === b.order ? byId : Number(a.order) - Number(b.order);
    return byId;
  };

  const tokenRef = (token: string) => doc(db, "inviteTokens", token);

  async function activeOwners(familyId: string): Promise<number> {
    const members = await getDocs(coll(db, "families", familyId, "members"));
    return members.docs.filter((d) => d.data().role === "owner" && d.data().leftAtMs === null).length;
  }

  /** Ruolo o uscita decisi dal proprietario: membro e accesso cambiano nello stesso batch. */
  async function ownerUpdate(
    familyId: string,
    memberId: string,
    patch: { role?: "owner" | "member"; leftAtMs?: number },
  ): Promise<R<void>> {
    const access = await accessOf(familyId);
    if (!access.ok) return access;
    if (access.value.role !== "owner") return err({ code: "forbidden" });
    const target = (await readDoc(familyId, "members", memberId)) as Member | null;
    if (!target) return notFound;
    const losesOwner =
      target.role === "owner" && target.leftAtMs === null && (patch.leftAtMs !== undefined || patch.role === "member");
    if (losesOwner && (await activeOwners(familyId)) <= 1) return err({ code: "conflict", reason: "last_owner" });
    const t = Date.now();
    try {
      const batch = writeBatch(db);
      batch.update(docRef(familyId, "members", memberId), {
        ...patch,
        updatedAtMs: t,
        updatedByMemberId: access.value.memberId,
      });
      if (target.userId && target.leftAtMs === null) {
        const accessRef = doc(db, "families", familyId, "access", target.userId);
        if (patch.leftAtMs !== undefined) batch.delete(accessRef);
        else batch.update(accessRef, { role: patch.role });
      }
      await batch.commit();
      return ok(undefined);
    } catch (error) {
      return failure(error);
    }
  }

  const membership: MembershipApi = {
    async myFamilies() {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) return err({ code: "unauthenticated" });
      try {
        const access = await getDocs(fsQuery(collectionGroup(db, "access"), fsWhere("userId", "==", user.uid)));
        const out = [];
        for (const a of access.docs) {
          const familyId = a.ref.parent.parent?.id;
          if (!familyId) continue;
          const family = await getDoc(familyRef(familyId));
          if (!family.exists()) continue;
          const parsed = familySchema.safeParse(family.data());
          if (!parsed.success) throw new Error(`Famiglia non valida: ${familyId}`);
          const data = a.data() as Access;
          out.push({ family: parsed.data, memberId: data.memberId, role: data.role });
        }
        return ok(out);
      } catch (error) {
        return failure(error);
      }
    },

    async createFamily(input) {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) return err({ code: "unauthenticated" });
      const t = Date.now();
      const ownerId = input.ownerMember.id;
      const audit = { createdAtMs: t, createdByMemberId: ownerId, updatedAtMs: t, updatedByMemberId: ownerId };
      const family = familySchema.safeParse({
        defaultSplit: { kind: "bp", shares: { [ownerId]: 10000 } },
        ...input.family,
        createdByUserId: user.uid,
        ...audit,
      });
      if (!family.success) return err({ code: "invalid", issues: zodIssues(family.error) });
      const member = parseDoc("members", { ...input.ownerMember, userId: user.uid, role: "owner", joinedAtMs: t, ...audit });
      if (!member.ok) return err({ code: "invalid", issues: member.error });
      const categories: AnyDoc[] = [];
      for (const category of input.defaults?.categories ?? []) {
        const parsed = parseDoc("categories", { ...category, ...audit });
        if (!parsed.ok) return err({ code: "invalid", issues: parsed.error });
        categories.push(parsed.value);
      }
      const f = family.data.id;
      try {
        // Le regole creano famiglia, membro e accesso nello stesso batch; le categorie vanno in un
        // secondo batch perché `isMember` legge l'accesso già scritto (validate prima, qui sopra).
        const batch = writeBatch(db);
        batch.set(familyRef(f), family.data);
        batch.set(docRef(f, "members", ownerId), withoutUndefined(member.value));
        batch.set(doc(db, "families", f, "access", user.uid), {
          userId: user.uid,
          memberId: ownerId,
          role: "owner",
          inviteToken: null,
        });
        await batch.commit();
        if (categories.length > 0) {
          const second = writeBatch(db);
          for (const category of categories) second.set(docRef(f, "categories", category.id), withoutUndefined(category));
          await second.commit();
        }
        return ok(f);
      } catch (error) {
        return failure(error);
      }
    },

    // Inviti (feature 6): l'invito vive in families/{f}/invites, il token in inviteTokens/{token}
    // (globale, così chi non è ancora membro lo legge). Le regole controllano scadenza, uso e revoca.
    async createInvite(familyId, invite) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      if (access.value.role !== "owner") return err({ code: "forbidden" });
      if (invite.memberId) {
        const target = await readDoc(familyId, "members", invite.memberId);
        if (!target || target.userId !== null)
          return err({ code: "invalid", issues: [{ path: "memberId", message: "serve un membro senza account" }] });
      }
      const prepared = await prepare(
        familyId,
        "invites",
        { ...invite, expiresAtMs: invite.expiresAtMs ?? Date.now() + INVITE_TTL_MS },
        access.value,
      );
      if (!prepared.ok) return prepared;
      const saved = prepared.value as unknown as Invite;
      const token = inviteToken();
      try {
        const batch = writeBatch(db);
        batch.set(docRef(familyId, "invites", saved.id), withoutUndefined(saved));
        batch.set(tokenRef(token), {
          familyId,
          inviteId: saved.id,
          expiresAtMs: saved.expiresAtMs,
          usedByUserId: null,
          role: saved.role,
          memberId: saved.memberId,
        });
        await batch.commit();
        return ok({ token });
      } catch (error) {
        return failure(error);
      }
    },

    async acceptInvite(token, displayName): Promise<Result<string, InviteError>> {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) return err({ code: "unauthenticated" });
      let ref: TokenDoc;
      try {
        const snap = await getDoc(tokenRef(token));
        if (!snap.exists()) return err({ code: "not_found" });
        ref = snap.data() as TokenDoc;
      } catch (error) {
        return failure(error, { code: "not_found" });
      }
      if (ref.usedByUserId !== null) return err({ code: "used" });
      const t = Date.now();
      if (ref.expiresAtMs <= t) return err({ code: "expired" });
      const f = ref.familyId;
      const existing = await getDoc(doc(db, "families", f, "access", user.uid)).catch(() => null);
      if (existing?.exists()) return err({ code: "conflict", reason: "already_member" });

      // Chi era già uscito rientra con lo stesso membro; altrimenti il segnaposto o un membro nuovo.
      // Le regole lasciano leggere a ognuno i membri legati al proprio uid, anche dopo l'uscita.
      const former = await getDocs(
        fsQuery(coll(db, "families", f, "members"), fsWhere("userId", "==", user.uid)),
      ).catch(() => null);
      const formerDoc = former?.docs[0];
      const memberId = formerDoc?.id ?? ref.memberId ?? newId();
      const stamp = { updatedAtMs: t, updatedByMemberId: memberId };
      try {
        const batch = writeBatch(db);
        if (formerDoc) {
          batch.update(docRef(f, "members", memberId), { leftAtMs: null, role: ref.role, joinedAtMs: t, ...stamp });
        } else if (ref.memberId) {
          batch.update(docRef(f, "members", memberId), { userId: user.uid, leftAtMs: null, ...stamp });
        } else {
          const member = parseDoc("members", {
            id: memberId,
            displayName,
            userId: user.uid,
            role: ref.role,
            joinedAtMs: t,
            createdAtMs: t,
            createdByMemberId: memberId,
            ...stamp,
          });
          if (!member.ok) return err({ code: "invalid", issues: member.error });
          batch.set(docRef(f, "members", memberId), withoutUndefined(member.value));
        }
        batch.set(doc(db, "families", f, "access", user.uid), {
          userId: user.uid,
          memberId,
          role: ref.role,
          inviteToken: token,
        });
        batch.update(docRef(f, "invites", ref.inviteId), { usedAtMs: t, usedByUserId: user.uid, ...stamp });
        batch.update(tokenRef(token), { usedByUserId: user.uid });
        await batch.commit();
        return ok(f);
      } catch (error) {
        // Token valido e non usato ma le regole dicono no: l'invito è stato revocato.
        if (error instanceof FirebaseError && error.code === "permission-denied") return err({ code: "revoked" });
        return failure(error);
      }
    },

    async leaveFamily(familyId) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      const me = access.value;
      if (me.role === "owner" && (await activeOwners(familyId)) <= 1)
        return err({ code: "conflict", reason: "last_owner" });
      const t = Date.now();
      try {
        const batch = writeBatch(db);
        batch.update(docRef(familyId, "members", me.memberId), {
          leftAtMs: t,
          updatedAtMs: t,
          updatedByMemberId: me.memberId,
        });
        batch.delete(doc(db, "families", familyId, "access", auth.currentUser?.uid ?? ""));
        await batch.commit();
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },

    async setMemberRole(familyId, memberId, role) {
      return ownerUpdate(familyId, memberId, { role });
    },

    async removeMember(familyId, memberId) {
      return ownerUpdate(familyId, memberId, { leftAtMs: Date.now() });
    },

    async setDefaultSplit(familyId, split) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      try {
        const members = await getDocs(coll(db, "families", familyId, "members"));
        const active = new Set(members.docs.filter((d) => d.data().leftAtMs === null).map((d) => d.id));
        const issues = familySplitIssues(split, active);
        if (issues.length > 0)
          return err({ code: "invalid", issues: issues.map((message) => ({ path: "defaultSplit", message })) });
        const batch = writeBatch(db);
        batch.update(doc(db, "families", familyId), {
          defaultSplit: { kind: split.kind, shares: { ...split.shares } },
          updatedAtMs: Date.now(),
          updatedByMemberId: access.value.memberId,
        });
        await batch.commit();
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },

    async claimMember() {
      throw new Error("Adapter Firebase: claimMember arriva con il feature 23.");
    },
    async exportFamily() {
      throw new Error("Adapter Firebase: exportFamily arriva con il feature 23.");
    },
    async importFamily() {
      throw new Error("Adapter Firebase: importFamily arriva con il feature 23.");
    },
  };

  const read = <C extends CollectionName>(c: C, data: AnyDoc): DocOf<C> => {
    const parsed = parseDoc(c, data);
    if (!parsed.ok) throw new Error(`Documento non valido in ${c}/${data.id}`);
    return parsed.value;
  };

  async function stage(familyId: string, batch: WriteBatch, op: CommitOp, me: Access): Promise<R<void>> {
    if (op.type === "remove") {
      batch.delete(docRef(familyId, op.collection, op.id));
      return ok(undefined);
    }
    const prepared = await prepare(familyId, op.collection, op.doc, me);
    if (!prepared.ok) return prepared;
    batch.set(docRef(familyId, op.collection, prepared.value.id), withoutUndefined(prepared.value));
    return ok(undefined);
  }

  return {
    kind: "firebase",
    auth: {
      async signUp(email, password) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
          return userOf(cred.user);
        } catch (error) {
          throw authFailure(error);
        }
      },
      async signIn(email, password) {
        try {
          const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
          return userOf(cred.user);
        } catch (error) {
          throw authFailure(error);
        }
      },
      async signOut() {
        await signOut(auth);
      },
      async currentUser() {
        await auth.authStateReady();
        return auth.currentUser ? userOf(auth.currentUser) : null;
      },
      onChange(listener) {
        return onAuthStateChanged(auth, (u) => {
          listener(u ? userOf(u) : null);
        });
      },
    },
    membership,

    async list(familyId, collection, query = {}) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
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

      const base: QueryConstraint[] = Object.entries(q.where ?? {}).map(([field, value]) => fsWhere(field, "==", value));
      if (q.dateFrom !== undefined) base.push(fsWhere("date", ">=", q.dateFrom));
      if (q.dateTo !== undefined) base.push(fsWhere("date", "<=", q.dateTo));
      const order: QueryConstraint[] =
        orderBy === "date_desc"
          ? [qOrderBy("date", "desc"), qOrderBy(documentId(), "desc")]
          : orderBy === "order_asc"
            ? [qOrderBy("order", "asc"), qOrderBy(documentId(), "asc")]
            : [qOrderBy(documentId(), "asc")];
      const cursor: QueryConstraint[] = q.after
        ? [
            orderBy === "date_desc"
              ? startAfter(q.after.date ?? "", q.after.id)
              : orderBy === "order_asc"
                ? startAfter(q.after.order ?? 0, q.after.id)
                : startAfter(q.after.id),
          ]
        : [];
      try {
        const snaps = await Promise.all(
          scopes(collection, q.scope, access.value).map((scope) =>
            getDocs(
              fsQuery(coll(db, "families", familyId, collection), ...scope, ...base, ...order, ...cursor, qLimit(limit + 1)),
            ),
          ),
        );
        const docs = snaps
          .flatMap((s) => s.docs.map((d): AnyDoc => ({ ...d.data(), id: d.id })))
          .sort(compareFor(orderBy));
        const pageDocs = docs.slice(0, limit);
        const last = pageDocs.at(-1);
        const next: Cursor | null =
          docs.length > limit && last
            ? orderBy === "date_desc"
              ? { id: last.id, date: String(last.date) }
              : orderBy === "order_asc"
                ? { id: last.id, order: Number(last.order) }
                : { id: last.id }
            : null;
        const page: Page<typeof collection> = { docs: pageDocs.map((d) => read(collection, d)), next };
        return ok(page);
      } catch (error) {
        return failure(error, { code: "not_found" });
      }
    },

    async get(familyId, collection, id) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      const found = await readDoc(familyId, collection, id);
      return found ? ok(read(collection, found)) : notFound;
    },

    async put(familyId, collection, input) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      const prepared = await prepare(familyId, collection, input, access.value);
      if (!prepared.ok) return prepared;
      try {
        const batch = writeBatch(db);
        batch.set(docRef(familyId, collection, prepared.value.id), withoutUndefined(prepared.value));
        await batch.commit();
        return ok(read(collection, prepared.value));
      } catch (error) {
        return failure(error);
      }
    },

    async remove(familyId, collection, id) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      const found = await readDoc(familyId, collection, id);
      if (!found) return notFound;
      if (collection === "members") return err({ code: "forbidden" });
      if (collection === "accounts" || collection === "categories" || collection === "payees") {
        const field = collection === "accounts" ? "accountId" : collection === "categories" ? "categoryId" : "payeeId";
        const used = await Promise.all(
          scopes("transactions", undefined, access.value).map((scope) =>
            getDocs(fsQuery(coll(db, "families", familyId, "transactions"), ...scope, fsWhere(field, "==", id), qLimit(1))),
          ),
        );
        const children =
          collection === "categories" &&
          !(await getDocs(fsQuery(coll(db, "families", familyId, "categories"), fsWhere("parentId", "==", id), qLimit(1))))
            .empty;
        if (children || used.some((s) => !s.empty)) return err({ code: "conflict", reason: "in_use" });
      }
      try {
        const batch = writeBatch(db);
        batch.delete(docRef(familyId, collection, id));
        await batch.commit();
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },

    async commit(familyId, ops) {
      const access = await accessOf(familyId);
      if (!access.ok) return access;
      if (ops.length > MAX_COMMIT_OPS)
        return err({ code: "invalid", issues: [{ path: "ops", message: "massimo 500 operazioni" }] });
      const batch = writeBatch(db);
      for (const op of ops) {
        const staged = await stage(familyId, batch, op, access.value);
        if (!staged.ok) return staged;
      }
      try {
        await batch.commit();
        return ok(undefined);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
