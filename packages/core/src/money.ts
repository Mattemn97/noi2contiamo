/** Importo in centesimi interi. Mai decimali per il denaro, in nessun livello. */
export type Cents = number & { readonly __brand: "Cents" };

/** Percentuale in punti base: 10000 = 100%. */
export type BasisPoints = number & { readonly __brand: "BasisPoints" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Importo non valido: ${value} (servono centesimi interi)`);
  }
  return value as Cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  return cents(values.reduce<number>((total, value) => total + value, 0));
}
