// AC-2: tema da sistema al primo avvio, scelta salvata sul dispositivo, nessun lampo al caricamento.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyThemePreference,
  parseThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_KEY,
} from "./theme";

const root = document.documentElement;

afterEach(() => {
  document.head.innerHTML = "";
  root.style.removeProperty("--color-page");
});

describe("preferenza del tema", () => {
  it("al primo avvio vale Sistema", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("accetta solo valori noti", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("blu")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("salva Chiaro e Scuro, e con Sistema toglie la chiave", () => {
    saveThemePreference("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(readThemePreference()).toBe("dark");
    saveThemePreference("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("non si rompe se l'archivio non è disponibile", () => {
    const broken = {
      getItem: () => {
        throw new Error("bloccato");
      },
      setItem: () => {
        throw new Error("bloccato");
      },
      removeItem: () => {
        throw new Error("bloccato");
      },
    };
    expect(readThemePreference(broken)).toBe("system");
    expect(() => {
      saveThemePreference("dark", broken);
    }).not.toThrow();
  });
});

describe("applicazione del tema", () => {
  it("mette data-theme su <html> e lo toglie con Sistema", () => {
    applyThemePreference("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyThemePreference("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("allinea theme-color al colore della pagina", () => {
    document.head.innerHTML = '<meta name="theme-color" content="" /><meta name="theme-color" content="" />';
    root.style.setProperty("--color-page", "#0d0d0d");
    applyThemePreference("dark");
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    expect(metas.map((meta) => meta.content)).toEqual(["#0d0d0d", "#0d0d0d"]);
  });
});

describe("script in linea di index.html (niente lampo)", () => {
  const html = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8");
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  // Esegue lo script di index.html come farebbe il browser prima di React.
  const run = (): void => {
    const script = document.createElement("script");
    script.textContent = inline;
    document.head.append(script);
  };

  it("sta nell'head, prima dello script del modulo", () => {
    expect(inline).toContain(THEME_KEY);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("applica la scelta salvata prima di React", () => {
    localStorage.setItem(THEME_KEY, "dark");
    run();
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("con Sistema o valori strani non mette l'attributo", () => {
    localStorage.setItem(THEME_KEY, "<script>");
    run();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});
