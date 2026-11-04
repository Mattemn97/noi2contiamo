// Unisce nomi di classe dei CSS Modules (che TypeScript vede come `string | undefined`) in una stringa.
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}
