import { expect, it } from "vitest";
import { newId } from "@noi2contiamo/core";
import { chunkOps } from "../index";
import { createMemoryAdapter } from "../memory";
import { runContractSuite } from "./suite";

runContractSuite("memory", createMemoryAdapter);

it("spezza i commit in blocchi da 500 (limite Firestore)", () => {
  const chunks = chunkOps(Array.from({ length: 1201 }, (_, i) => i));
  expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
});

it("i token di invito sono 26 caratteri base32 e non si indovinano dal tempo", async () => {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", "x");
  const familyId = newId();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa" },
    ownerMember: { id: newId(), displayName: "Anna" },
  });
  const tokens = await Promise.all(
    [1, 2, 3].map(async () => {
      const result = await adapter.membership.createInvite(familyId, { id: newId() });
      return result.ok ? result.value.token : "";
    }),
  );
  for (const token of tokens) expect(token).toMatch(/^[a-z2-7]{26}$/);
  expect(new Set(tokens).size).toBe(3);
});

it("l'export non contiene password né token di invito", async () => {
  const adapter = createMemoryAdapter();
  await adapter.auth.signUp("anna@example.com", "segreta-123");
  const familyId = newId();
  await adapter.membership.createFamily({
    family: { id: familyId, name: "Casa" },
    ownerMember: { id: newId(), displayName: "Anna" },
  });
  const invite = await adapter.membership.createInvite(familyId, { id: newId() });
  const file = await adapter.membership.exportFamily(familyId);
  const text = JSON.stringify(file);
  expect(text).not.toContain("segreta-123");
  expect(invite.ok && text.includes(invite.value.token)).toBe(false);
});
