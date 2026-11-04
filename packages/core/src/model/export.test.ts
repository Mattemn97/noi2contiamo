// covers: AC-8 (formato noi2contiamo-export v1, funzioni pure)
import { describe, expect, it } from "vitest";
import {
  buildExport,
  isCollectionName,
  isIsoDate,
  isUuidV7,
  newId,
  readExport,
  type ExportCollections,
} from "../index";

const ownerId = newId();
const audit = { createdAtMs: 1, createdByMemberId: ownerId, updatedAtMs: 1, updatedByMemberId: ownerId };
const family = {
  id: newId(),
  name: "Casa",
  currency: "EUR",
  defaultSplit: { kind: "bp" as const, shares: { [ownerId]: 10000 } },
  schemaVersion: 1,
  createdByUserId: "uid-firebase",
  ...audit,
};
const member = {
  id: ownerId,
  displayName: "Anna",
  userId: "uid-firebase",
  role: "owner" as const,
  color: null,
  joinedAtMs: 1,
  leftAtMs: null,
  ...audit,
};
const empty = {
  members: [],
  invites: [],
  accounts: [],
  categories: [],
  payees: [],
  transactions: [],
  rules: [],
  importProfiles: [],
  importBatches: [],
  recurrences: [],
  recurrenceDismissals: [],
  memberSettings: [],
  reminders: [],
} satisfies ExportCollections;

const file = () =>
  buildExport({
    exportedAtMs: 5,
    sourceBackend: "firebase",
    family,
    users: [{ userId: "uid-firebase", email: "anna@example.com", displayName: "Anna" }],
    collections: { ...empty, members: [member] },
  });

describe("export e import v1 (AC-8)", () => {
  it("costruisce il file con formato e versione", () => {
    expect(file()).toMatchObject({ format: "noi2contiamo-export", version: 1, sourceBackend: "firebase" });
  });

  it("all'import scollega i membri dagli account e tiene gli stessi id", () => {
    const result = readExport(JSON.parse(JSON.stringify(file())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.collections.members).toEqual([{ ...member, userId: null }]);
    expect(result.value.family).toEqual(family);
  });

  it("rifiuta formato, versione, collezioni sconosciute e documenti non validi", () => {
    expect(readExport({ ...file(), format: "altro" }).ok).toBe(false);
    expect(readExport({ ...file(), version: 2 }).ok).toBe(false);
    expect(readExport({ ...file(), collections: { ...empty, sessions: [] } }).ok).toBe(false);
    const broken = readExport({
      ...file(),
      collections: { ...empty, members: [{ ...member, role: "admin" }] },
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error[0]?.path).toMatch(/^collections\.members\.0/);
    expect(readExport(null).ok).toBe(false);
  });

  it("due export degli stessi documenti in ordine diverso sono identici", () => {
    const a = { ...member, id: newId() };
    const b = { ...member, id: newId(), userId: null };
    const one = buildExport({ ...file(), collections: { ...empty, members: [a, b] } });
    const two = buildExport({ ...file(), collections: { ...empty, members: [b, a] } });
    expect(one).toEqual(two);
  });
});

describe("tipi di base", () => {
  it("riconosce UUIDv7, date di calendario reali e nomi di collezione", () => {
    expect(isUuidV7(newId())).toBe(true);
    expect(isUuidV7("8c1d2f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isCollectionName("transactions")).toBe(true);
    expect(isCollectionName("access")).toBe(false);
  });
});
