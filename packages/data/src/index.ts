// Il confine tra dominio e dati. Collezioni, schemi e query ammesse li fissa il registro di `core` (spec 0002).
import type {
  AuditKey,
  CollectionName,
  DateCollection,
  DocOf,
  ExportFile,
  Family,
  FamilyInput,
  IndexedField,
  IsoDate,
  OrderByOf,
  Result,
  SplitSpec,
  ScopedCollection,
  ValidationIssue,
  WriteDocOf,
} from "@noi2contiamo/core";

export type { CollectionName, DocOf, WriteDocOf } from "@noi2contiamo/core";

export type FamilyId = string;
export type DocId = string;

export interface User {
  id: string;
  email: string;
}

/** Errori attesi, come valori. `not_found` vale anche per "non sei membro": non rivela che la famiglia esiste. */
export type DataError =
  | { readonly code: "unauthenticated" }
  | { readonly code: "not_found" }
  | { readonly code: "forbidden" }
  | { readonly code: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "invalid_query"; readonly message: string }
  | {
      readonly code: "conflict";
      readonly reason: "duplicate" | "duplicate_fingerprint" | "in_use" | "last_owner" | "already_member";
    };

export type InviteError = { readonly code: "expired" | "used" | "revoked" | "not_found" } | DataError;

/** Cursore: la posizione dell'ultimo documento letto, nell'ordine della query. */
export interface Cursor {
  readonly id: DocId;
  readonly date?: IsoDate;
  readonly order?: number;
}

export const MAX_LIST_LIMIT = 500;

type WhereOf<C extends CollectionName> = {
  readonly [K in IndexedField<C> & keyof DocOf<C>]?: DocOf<C>[K];
};

/** Solo le query dichiarate nel registro: un campo non indicizzato in `where` è un errore di tipo. */
export type Query<C extends CollectionName> = {
  readonly where?: WhereOf<C>;
  readonly orderBy?: OrderByOf<C>;
  /** Da 1 a 500 (default 500). */
  readonly limit?: number;
  readonly after?: Cursor;
} & (C extends DateCollection ? { readonly dateFrom?: IsoDate; readonly dateTo?: IsoDate } : unknown) &
  (C extends ScopedCollection ? { readonly scope?: "shared" | "mine" } : unknown);

export interface Page<C extends CollectionName> {
  readonly docs: DocOf<C>[];
  readonly next: Cursor | null;
}

export type CommitOp = {
  [C in CollectionName]:
    | { readonly type: "put"; readonly collection: C; readonly doc: WriteDocOf<C> }
    | { readonly type: "remove"; readonly collection: C; readonly id: DocId };
}[CollectionName];

export interface FamilySummary {
  readonly family: Family;
  readonly memberId: DocId;
  readonly role: "owner" | "member";
}

export interface CreateFamilyInput {
  readonly family: Omit<FamilyInput, AuditKey | "createdByUserId" | "defaultSplit"> &
    Partial<Pick<FamilyInput, "defaultSplit">>;
  readonly ownerMember: { readonly id: DocId; readonly displayName: string; readonly color?: string | null };
  readonly defaults?: { readonly categories?: readonly WriteDocOf<"categories">[] };
}

export interface NewInvite {
  readonly id: DocId;
  readonly role?: "owner" | "member";
  /** Lega l'invito a un membro segnaposto esistente; assente = nuovo membro. */
  readonly memberId?: DocId | null;
  readonly expiresAtMs?: number;
}

export interface MembershipApi {
  myFamilies(): Promise<Result<FamilySummary[], DataError>>;
  /** Atomico: famiglia, membro proprietario, accesso e categorie iniziali. */
  createFamily(input: CreateFamilyInput): Promise<Result<FamilyId, DataError>>;
  /** Il token in chiaro si vede solo qui. */
  createInvite(familyId: FamilyId, invite: NewInvite): Promise<Result<{ token: string }, DataError>>;
  acceptInvite(token: string, displayName: string): Promise<Result<FamilyId, InviteError>>;
  leaveFamily(familyId: FamilyId): Promise<Result<void, DataError>>;
  /** Solo il proprietario; `conflict/last_owner` se la famiglia resterebbe senza proprietari. */
  setMemberRole(familyId: FamilyId, memberId: DocId, role: "owner" | "member"): Promise<Result<void, DataError>>;
  /** Solo il proprietario: il membro resta nello storico (`leftAtMs`) e perde l'accesso. */
  removeMember(familyId: FamilyId, memberId: DocId): Promise<Result<void, DataError>>;
  /** Ogni membro attivo: divisione predefinita della famiglia (spec 0004, AC-7); chiavi = membri attivi. */
  setDefaultSplit(familyId: FamilyId, split: SplitSpec): Promise<Result<void, DataError>>;
  /** Ricollega un membro importato (`userId: null`) all'utente con la stessa email dell'export. */
  claimMember(familyId: FamilyId, memberId: DocId): Promise<Result<void, DataError>>;
  exportFamily(familyId: FamilyId): Promise<Result<ExportFile, DataError>>;
  importFamily(file: ExportFile): Promise<Result<FamilyId, DataError>>;
}

/** Errore di accesso: le funzioni di `AuthApi` lo lanciano quando l'operazione non riesce. */
export class AuthError extends Error {
  constructor(
    readonly code: "invalid_credentials" | "email_taken" | "weak_password" | "invalid_email" | "unavailable",
    message: string = code,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthApi {
  /** `displayName` è facoltativo: senza, il server usa la parte dell'email prima della chiocciola. */
  signUp(email: string, password: string, displayName?: string): Promise<User>;
  signIn(email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  currentUser(): Promise<User | null>;
  /** Restituisce la funzione per smettere di ascoltare. */
  onChange(listener: (user: User | null) => void): () => void;
}

export interface DataAdapter {
  readonly kind: "memory" | "firebase" | "http";
  readonly auth: AuthApi;
  readonly membership: MembershipApi;
  list<C extends CollectionName>(
    familyId: FamilyId,
    collection: C,
    query?: Query<C>,
  ): Promise<Result<Page<C>, DataError>>;
  get<C extends CollectionName>(familyId: FamilyId, collection: C, id: DocId): Promise<Result<DocOf<C>, DataError>>;
  /** Valida con lo schema di `core` e mette l'audit; restituisce il documento salvato. */
  put<C extends CollectionName>(
    familyId: FamilyId,
    collection: C,
    doc: WriteDocOf<C>,
  ): Promise<Result<DocOf<C>, DataError>>;
  remove(familyId: FamilyId, collection: CollectionName, id: DocId): Promise<Result<void, DataError>>;
  /** Atomico: o tutte le operazioni o nessuna (max 500, vedi `chunkOps`). */
  commit(familyId: FamilyId, ops: readonly CommitOp[]): Promise<Result<void, DataError>>;
}

/** Limite dei batch Firestore: i commit più lunghi vanno spezzati in blocchi. */
export const MAX_COMMIT_OPS = 500;

export function chunkOps<T>(ops: readonly T[], size = MAX_COMMIT_OPS): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ops.length; i += size) chunks.push(ops.slice(i, i + size));
  return chunks;
}
