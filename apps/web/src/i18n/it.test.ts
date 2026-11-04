import { expect, it as test } from "vitest";
import { t } from "./it";

test("t() sostituisce i parametri nel testo italiano", () => {
  expect(t("status.backend", { backend: "http" })).toBe("Modalità dati: http");
});
