// Un codice breve e innocuo da mostrare accanto ai messaggi d'errore, utile per la diagnostica.
import { DataQueryError } from "../data/queries";

export function errorCode(error: unknown): string {
  if (error instanceof DataQueryError) {
    const { code } = error.error;
    const reason =
      "reason" in error.error && typeof error.error.reason === "string" ? `/${error.error.reason}` : "";
    return `${code}${reason}`;
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string")
    return error.code;
  return error instanceof Error ? error.name : "unknown";
}
