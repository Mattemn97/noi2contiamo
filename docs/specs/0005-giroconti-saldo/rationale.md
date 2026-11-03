# 0005. Giroconti e saldo tra i membri: decision record

## Context

Lo spec 0002 ha già il giroconto (`type: "transfer"`, `toAccountId`, `settlement`, due impronte di import) e lo spec 0004 salva la divisione come fotografia su ogni movimento. Mancavano: come si calcola il saldo tra i membri (cassa comune, entrate, rimborsi, giroconti tra persone), come si propone e si registra il pareggio, come si riconosce un giroconto da due righe separate. Lavoro non interattivo: ogni scelta qui sotto è quella raccomandata, con il suo perché in una riga.

## Options considered

### Option 1: saldo alla lettura in `core`, pareggio come giroconto
**Pros**: un solo codice, nessuna migrazione, il saldo segue sempre i movimenti. **Cons**: legge tutti i movimenti visibili.

### Option 2: saldo salvato e aggiornato a ogni scrittura
**Pros**: lettura veloce. **Cons**: due backend da tenere allineati, Firestore senza funzioni server sul piano Spark, rischio di saldi sbagliati dopo modifiche e cancellazioni.

### Option 3: pareggio come tipo di movimento a parte
**Cons**: lo spec 0002 lo modella già come giroconto con `settlement`; un tipo nuovo vorrebbe dire migrazione e regole nuove.

## Rationale

Scelte prese (raccomandate):
- Option 1: stessa strada del saldo dei conti, già in `core`, funziona sul piano Spark.
- Saldo positivo = credito: si legge "gli altri ti devono", la frase "X deve a Y" esce dal segno.
- Cassa comune ripartita con `families.defaultSplit`: una coppia che versa nel conto comune e spende 50/50 ottiene il risultato giusto senza nuovi campi; runner up: una divisione per conto (follow-up).
- Giroconto tra membri diversi conta sempre, con o senza `settlement`: i soldi passati da una persona all'altra spostano il saldo; `settlement` è un'etichetta che rende esplicite le parti.
- Entrate con la stessa logica delle spese, a segni invertiti: un'entrata comune incassata da uno va divisa con l'altro.
- Rimborsi con il segno opposto del loro tipo: un rimborso di una spesa comune annulla quella spesa anche nel saldo.
- Privati esclusi: valgono zero per definizione e così il saldo non cambia tra chi guarda.
- Piano di pareggio minimo esatto con insiemi a somma zero (al più 2^12 sottoinsiemi), greedy oltre: per una famiglia è istantaneo e dà il minimo vero.
- Pareggio con importo modificabile: permette di pareggiare a rate; il saldo mostra quanto resta.
- Riconoscimento: stesso importo, conti diversi, entro 3 giorni, prima le date più vicine: copre il ritardo tipico tra due banche senza falsi positivi frequenti; l'utente conferma sempre con "Unisci".
- Nessuna route server: `put` e `commit` bastano e sono già coperti dalla contract suite.

## References

Nessun riferimento esterno: decisione presa sugli spec 0002 e 0004 e sul codice esistente.
