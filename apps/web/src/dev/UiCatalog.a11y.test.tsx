// AC-5: la pagina catalogo /dev/ui non ha violazioni axe, in tema chiaro e scuro.
// jsdom non calcola gli stili: il contrasto lo controlla tokens.test.ts (AC-3), qui il resto delle regole.
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { UiProvider } from "../ui";
import { UiCatalog } from "./UiCatalog";

async function violations(): Promise<readonly string[]> {
  const result = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}

describe("catalogo /dev/ui", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`nessuna violazione axe in tema ${theme}`, async () => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.lang = "it";
      document.title = "Noi2Contiamo";
      render(
        <UiProvider>
          <UiCatalog />
        </UiProvider>,
      );
      // I grafici arrivano con React.lazy: aspetta che ci siano tutti.
      expect(
        await screen.findByRole("heading", { name: "Novembre contro ottobre" }, { timeout: 30_000 }),
      ).toBeTruthy();
      expect(await violations()).toEqual([]);
    }, 90_000);
  }
});
