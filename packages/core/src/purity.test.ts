// AC-7: packages/core non importa React, Firebase, fetch né API del browser legate all'IO.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const ALLOWED_PACKAGES = new Set(["zod", "date-fns", "uuid", "@noble/hashes"]);
const FORBIDDEN_GLOBALS =
  /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document|window|navigator)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const stripComments = (code: string) => code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");

describe("purezza di packages/core", () => {
  const files = sourceFiles(SRC);

  it("trova dei sorgenti da controllare", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s importa solo moduli relativi o ammessi", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    const specifiers = [...code.matchAll(/(?:^|[\s;])(?:from|import)\s*\(?\s*["']([^"']+)["']/gm)].map(
      (m) => m[1]!,
    );
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) continue;
      const parts = specifier.split("/");
      const pkg = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
      expect(ALLOWED_PACKAGES.has(pkg), `${file} importa ${specifier}`).toBe(true);
    }
  });

  it.each(files)("%s non usa API di IO del browser", (file) => {
    expect(stripComments(readFileSync(file, "utf8"))).not.toMatch(FORBIDDEN_GLOBALS);
  });
});
