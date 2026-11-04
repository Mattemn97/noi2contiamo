/** Testo normalizzato: minuscolo, senza accenti, spazi compressi, senza spazi ai bordi. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
