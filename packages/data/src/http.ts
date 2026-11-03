// Adapter verso il server FastAPI (`/api/v1`). Tipi generati da OpenAPI (`npm run gen:api`),
// documenti validati con gli schemi di `core` prima di scrivere e dopo aver letto (spec 0002).
import { AUDIT_KEYS, err, ok, parseDoc, type CollectionName, type DocOf, type Result } from "@noi2contiamo/core";
import createClient from "openapi-fetch";
import type { components, paths } from "./api.gen";
import {
  AuthError,
  type CommitOp,
  type Cursor,
  type DataAdapter,
  type DataError,
  type FamilySummary,
  type InviteError,
  type MembershipApi,
  type Page,
  type User,
} from "./index";

export type HttpAdapter = DataAdapter & { health(): Promise<boolean> };

export interface HttpAdapterOptions {
  /** Origine del server; vuoto = stessa origine della pagina. */
  readonly baseUrl?: string;
  /** `fetch` da usare (nei test: uno con il suo barattolo di cookie). */
  readonly fetch?: typeof globalThis.fetch;
}

type ErrorBody = {
  readonly code?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly issues?: { path: string; message: string }[];
};

const INVITE_CODES = new Set(["expired", "used", "revoked"]);

/** Risposta di errore → `DataError` (stessi codici dell'adapter memory). */
function toDataError(status: number, body: unknown): DataError {
  const b = (typeof body === "object" && body !== null ? body : {}) as ErrorBody;
  if (status === 401) return { code: "unauthenticated" };
  if (status === 403) return { code: "forbidden" };
  if (status === 404) return { code: "not_found" };
  if (status === 409)
    return { code: "conflict", reason: (b.reason ?? "duplicate") as Extract<DataError, { code: "conflict" }>["reason"] };
  if (status === 422 && b.code === "invalid_query") return { code: "invalid_query", message: b.message ?? "" };
  if (status === 422) return { code: "invalid", issues: b.issues ?? [] };
  throw new Error(`Risposta inattesa dal server: ${status}`);
}

function toInviteError(status: number, body: unknown): InviteError {
  const code = (body as ErrorBody | undefined)?.code;
  if (status === 410 && code && INVITE_CODES.has(code)) return { code: code as "expired" | "used" | "revoked" };
  return toDataError(status, body);
}

/** Il documento come lo vuole il server: default di `core` applicati, audit tolto (lo mette il server). */
function prepare(collection: CollectionName, doc: object): Result<Record<string, unknown>, DataError> {
  const raw = doc as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const placeholder = { createdAtMs: 0, createdByMemberId: id, updatedAtMs: 0, updatedByMemberId: id };
  const parsed = parseDoc(collection, { ...raw, ...placeholder });
  if (!parsed.ok) return err({ code: "invalid", issues: parsed.error });
  const audit = new Set<string>(AUDIT_KEYS);
  return ok(Object.fromEntries(Object.entries(parsed.value).filter(([key]) => !audit.has(key))));
}

function read<C extends CollectionName>(collection: C, doc: unknown): DocOf<C> {
  const parsed = parseDoc(collection, doc);
  if (!parsed.ok) throw new Error(`Documento non valido dal server in ${collection}: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

export function createHttpAdapter(options: HttpAdapterOptions = {}): HttpAdapter {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((input: Request) => globalThis.fetch(input));
  let csrfToken: string | null = null;
  const listeners = new Set<(user: User | null) => void>();
  const notify = (user: User | null) => {
    for (const listener of listeners) listener(user);
  };

  const client = createClient<paths>({ baseUrl, fetch: doFetch });

  async function session(): Promise<components["schemas"]["SessionOut"]> {
    const { data, response } = await client.GET("/api/v1/auth/session");
    if (!data) throw new AuthError("unavailable", `Server non raggiungibile (${response.status})`);
    csrfToken = data.csrfToken;
    return data;
  }

  client.use({
    async onRequest({ request }) {
      if (request.method === "GET" || request.method === "HEAD") return request;
      csrfToken ??= (await session()).csrfToken;
      request.headers.set("X-CSRF-Token", csrfToken);
      return request;
    },
  });

  const family = (familyId: string) => ({ family_id: familyId });

  const authFailure = (status: number, body: unknown): AuthError => {
    const b = body as ErrorBody | undefined;
    if (status === 401) return new AuthError("invalid_credentials");
    if (status === 409) return new AuthError("email_taken");
    if (status === 422) {
      const passwordIssue = b?.issues?.some((i) => i.path.includes("password")) ?? false;
      return new AuthError(passwordIssue ? "weak_password" : "invalid_email");
    }
    return new AuthError("unavailable", `Errore del server (${status})`);
  };

  async function updateMember(
    familyId: string,
    memberId: string,
    patch: { role?: "owner" | "member"; leftAtMs?: number },
  ): Promise<Result<void, DataError>> {
    const current = await adapter.get(familyId, "members", memberId);
    if (!current.ok) return current;
    const saved = await adapter.put(familyId, "members", { ...current.value, ...patch });
    return saved.ok ? ok(undefined) : saved;
  }

  const membership: MembershipApi = {
    async myFamilies() {
      const { data, error, response } = await client.GET("/api/v1/families");
      if (!data) return err(toDataError(response.status, error));
      return ok(
        data.map(
          (s): FamilySummary => ({ family: s.family as FamilySummary["family"], memberId: s.memberId, role: s.role }),
        ),
      );
    },

    async createFamily(input) {
      const categories: Record<string, unknown>[] = [];
      for (const category of input.defaults?.categories ?? []) {
        const prepared = prepare("categories", category);
        if (!prepared.ok) return prepared;
        categories.push(prepared.value);
      }
      const { data, error, response } = await client.POST("/api/v1/families", {
        body: {
          family: {
            id: input.family.id,
            name: input.family.name,
            ...(input.family.currency !== undefined ? { currency: input.family.currency } : {}),
            ...(input.family.defaultSplit !== undefined
              ? { defaultSplit: input.family.defaultSplit }
              : {}),
          },
          ownerMember: {
            id: input.ownerMember.id,
            displayName: input.ownerMember.displayName,
            color: input.ownerMember.color ?? null,
          },
          defaults: { categories },
        },
      });
      return data ? ok(data.familyId) : err(toDataError(response.status, error));
    },

    async createInvite(familyId, invite) {
      const { data, error, response } = await client.POST("/api/v1/families/{family_id}/invites", {
        params: { path: family(familyId) },
        body: {
          id: invite.id,
          role: invite.role ?? "member",
          memberId: invite.memberId ?? null,
          expiresAtMs: invite.expiresAtMs ?? null,
        },
      });
      return data ? ok({ token: data.token }) : err(toDataError(response.status, error));
    },

    async acceptInvite(token, displayName) {
      const { data, error, response } = await client.POST("/api/v1/invites/accept", {
        body: { token, displayName },
      });
      return data ? ok(data.familyId) : err(toInviteError(response.status, error));
    },

    async leaveFamily(familyId) {
      const { error, response } = await client.POST("/api/v1/families/{family_id}/leave", {
        params: { path: family(familyId) },
      });
      return response.ok ? ok(undefined) : err(toDataError(response.status, error));
    },

    // Ruolo e rimozione sono scritture sul membro: il server controlla proprietario e ultimo proprietario.
    async setMemberRole(familyId, memberId, role) {
      return updateMember(familyId, memberId, { role });
    },
    async removeMember(familyId, memberId) {
      return updateMember(familyId, memberId, { leftAtMs: Date.now() });
    },

    async setDefaultSplit(familyId, split) {
      const { error, response } = await client.PUT("/api/v1/families/{family_id}/default-split", {
        params: { path: family(familyId) },
        body: { kind: split.kind, shares: { ...split.shares } },
      });
      return response.ok ? ok(undefined) : err(toDataError(response.status, error));
    },

    // Export, import e reclamo dei membri arrivano con il feature 23 (backup e spostamento dati).
    async claimMember() {
      throw new Error("Adapter HTTP: claimMember arriva con il feature 23.");
    },
    async exportFamily() {
      throw new Error("Adapter HTTP: exportFamily arriva con il feature 23.");
    },
    async importFamily() {
      throw new Error("Adapter HTTP: importFamily arriva con il feature 23.");
    },
  };

  const credentials = async (
    path: "/api/v1/auth/register" | "/api/v1/auth/login",
    body: { email: string; password: string; displayName?: string | null },
  ): Promise<User> => {
    const { data, error, response } =
      path === "/api/v1/auth/register"
        ? await client.POST("/api/v1/auth/register", { body })
        : await client.POST("/api/v1/auth/login", { body: { email: body.email, password: body.password } });
    if (data === undefined) throw authFailure(response.status, error);
    notify(data);
    return data;
  };

  const adapter: HttpAdapter = {
    kind: "http",
    auth: {
      signUp: (email, password, displayName) =>
        credentials("/api/v1/auth/register", { email, password, displayName: displayName ?? null }),
      signIn: (email, password) => credentials("/api/v1/auth/login", { email, password }),
      async signOut() {
        await client.POST("/api/v1/auth/logout");
        notify(null);
      },
      async currentUser() {
        return (await session()).user;
      },
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    membership,

    async list(familyId, collection, query = {}) {
      const q = query as {
        where?: object;
        orderBy?: string;
        limit?: number;
        after?: Cursor;
        dateFrom?: string;
        dateTo?: string;
        scope?: string;
      };
      const { data, error, response } = await client.GET("/api/v1/families/{family_id}/{collection}", {
        params: {
          path: { ...family(familyId), collection },
          query: {
            ...(q.where !== undefined ? { where: JSON.stringify(q.where) } : {}),
            ...(q.orderBy !== undefined ? { orderBy: q.orderBy } : {}),
            ...(q.limit !== undefined ? { limit: q.limit } : {}),
            ...(q.after !== undefined ? { after: JSON.stringify(q.after) } : {}),
            ...(q.dateFrom !== undefined ? { dateFrom: q.dateFrom } : {}),
            ...(q.dateTo !== undefined ? { dateTo: q.dateTo } : {}),
            ...(q.scope !== undefined ? { scope: q.scope } : {}),
          },
        },
      });
      if (!data) return err(toDataError(response.status, error));
      const page: Page<typeof collection> = {
        docs: data.docs.map((d) => read(collection, d)),
        next: (data.next as Cursor | null) ?? null,
      };
      return ok(page);
    },

    async get(familyId, collection, id) {
      const { data, error, response } = await client.GET("/api/v1/families/{family_id}/{collection}/{doc_id}", {
        params: { path: { ...family(familyId), collection, doc_id: id } },
      });
      return data ? ok(read(collection, data)) : err(toDataError(response.status, error));
    },

    async put(familyId, collection, doc) {
      const prepared = prepare(collection, doc);
      if (!prepared.ok) return prepared;
      const id = String(prepared.value.id);
      const { data, error, response } = await client.PUT("/api/v1/families/{family_id}/{collection}/{doc_id}", {
        params: { path: { ...family(familyId), collection, doc_id: id } },
        body: prepared.value,
      });
      return data ? ok(read(collection, data)) : err(toDataError(response.status, error));
    },

    async remove(familyId, collection, id) {
      const { error, response } = await client.DELETE("/api/v1/families/{family_id}/{collection}/{doc_id}", {
        params: { path: { ...family(familyId), collection, doc_id: id } },
      });
      return response.ok ? ok(undefined) : err(toDataError(response.status, error));
    },

    async commit(familyId, ops: readonly CommitOp[]) {
      const body: components["schemas"]["Commit"]["ops"] = [];
      for (const op of ops) {
        if (op.type === "remove") {
          body.push({ type: "remove", collection: op.collection, id: op.id });
          continue;
        }
        const prepared = prepare(op.collection, op.doc);
        if (!prepared.ok) return prepared;
        body.push({ type: "put", collection: op.collection, doc: prepared.value });
      }
      const { error, response } = await client.POST("/api/v1/families/{family_id}/commit", {
        params: { path: family(familyId) },
        body: { ops: body },
      });
      return response.ok ? ok(undefined) : err(toDataError(response.status, error));
    },

    async health() {
      const response = await doFetch(new Request(new URL("/api/health", baseUrl || globalThis.location.origin)));
      return response.ok;
    },
  };
  return adapter;
}
