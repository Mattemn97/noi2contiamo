import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, filterOf, parseRegister, serializeRegister } from "./registerUrl";

const parse = (query: string) => parseRegister(new URLSearchParams(query));

describe("stato del registro nell'URL", () => {
  it("senza parametri: questo mese, nessun filtro, prima pagina", () => {
    expect(parse("")).toEqual({
      preset: DEFAULT_PRESET,
      from: null,
      to: null,
      type: null,
      accountId: null,
      memberId: null,
      categoryId: null,
      payeeId: null,
      text: "",
      page: 1,
    });
    expect(serializeRegister(parse("")).toString()).toBe("");
  });

  it("andata e ritorno con tutti i filtri", () => {
    const query =
      "periodo=personalizzato&dal=2026-05-01&al=2026-05-31&tipo=entrate&conto=a1&persona=none&categoria=c1&destinatario=p1&q=coop+lombardia&pagina=3";
    const state = parse(query);
    expect(state).toMatchObject({
      preset: "custom",
      from: "2026-05-01",
      type: "income",
      memberId: "none",
      page: 3,
    });
    expect(serializeRegister(state).toString()).toBe(query);
    expect(filterOf(state)).toEqual({
      type: "income",
      accountId: "a1",
      memberId: "none",
      categoryId: "c1",
      payeeId: "p1",
      text: "coop lombardia",
    });
  });

  it("valori sbagliati diventano i default; le date da sole vogliono dire personalizzato", () => {
    expect(parse("periodo=boh&tipo=altro&pagina=-2&dal=2026-02-30")).toMatchObject({
      preset: DEFAULT_PRESET,
      type: null,
      page: 1,
      from: null,
    });
    expect(parse("dal=2026-01-01")).toMatchObject({ preset: "custom", from: "2026-01-01", to: null });
    expect(parse("periodo=tutto&dal=2026-01-01")).toMatchObject({ preset: "all", from: null });
  });
});
