// Dai byte del file al testo (spec 0006, AC-1): UTF-8 e Windows-1252 scritti a mano, niente API di IO.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type FileEncoding = "utf-8" | "windows-1252" | "iso-8859-1";

/** I caratteri di Windows-1252 tra 0x80 e 0x9F (gli altri coincidono con ISO-8859-1). */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d,
  0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x9d, 0x017e, 0x0178,
];

const hasBom = (bytes: Uint8Array) => bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/** Decodifica UTF-8; null se i byte non sono UTF-8 valido. */
function decodeUtf8(bytes: Uint8Array): string | null {
  const out: string[] = [];
  let i = hasBom(bytes) ? 3 : 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    let cp: number;
    let extra: number;
    if (b < 0x80) {
      cp = b;
      extra = 0;
    } else if (b >= 0xc2 && b <= 0xdf) {
      cp = b & 0x1f;
      extra = 1;
    } else if (b >= 0xe0 && b <= 0xef) {
      cp = b & 0x0f;
      extra = 2;
    } else if (b >= 0xf0 && b <= 0xf4) {
      cp = b & 0x07;
      extra = 3;
    } else return null;
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (next & 0x3f);
    }
    const min = [0, 0x80, 0x800, 0x10000][extra] ?? 0;
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out.push(String.fromCodePoint(cp));
    i += extra + 1;
  }
  return out.join("");
}

function decodeSingleByte(bytes: Uint8Array, cp1252: boolean): string {
  const out: string[] = [];
  for (const b of bytes)
    out.push(String.fromCharCode(cp1252 && b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] ?? b) : b));
  return out.join("");
}

/** BOM o UTF-8 valido → `utf-8`; altrimenti `windows-1252` (il caso tipico dei file italiani). */
export function detectEncoding(bytes: Uint8Array): FileEncoding {
  if (hasBom(bytes)) return "utf-8";
  return decodeUtf8(bytes) === null ? "windows-1252" : "utf-8";
}

/** Il testo del file; un UTF-8 non valido si legge come Windows-1252 invece di perdere caratteri. */
export function decodeBytes(bytes: Uint8Array, encoding: FileEncoding): string {
  if (encoding === "utf-8") return decodeUtf8(bytes) ?? decodeSingleByte(bytes, true);
  return decodeSingleByte(bytes, encoding === "windows-1252");
}

/** SHA-256 esadecimale del file (per riconoscere un file già importato). */
export function fileHash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
