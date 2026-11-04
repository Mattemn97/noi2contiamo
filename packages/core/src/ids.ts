import { v7 as uuidv7 } from "uuid";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Id di documento: UUIDv7 in minuscolo, generato dal client. */
export type Id = string;
export type MemberId = string;
export type FamilyId = string;
/** Identità di login, opaca: uid Firebase o UUIDv7 del server. */
export type UserId = string;
/** Giorno di calendario `YYYY-MM-DD`, senza fuso. */
export type IsoDate = string;
/** Istante in millisecondi UTC. */
export type EpochMs = number;

export const isUuidV7 = (value: string): boolean => UUID_V7.test(value);

/** Nuovo id ordinabile nel tempo. */
export const newId = (): Id => uuidv7();

/** Vero se `value` è un giorno di calendario reale nel formato `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}
