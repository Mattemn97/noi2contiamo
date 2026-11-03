# 0005. Giroconti e saldo tra i membri: registro a partite in `core`, pareggio come giroconto

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Un giroconto sposta soldi tra due conti della famiglia e non conta mai come entrata o spesa. Il saldo tra i membri ("chi deve a chi") si calcola in `packages/core` leggendo i movimenti visibili: chi ha pagato contro la quota di ciascuno, più i giroconti tra persone diverse. La cassa comune (un conto senza proprietario) appartiene ai membri secondo la divisione della famiglia. Dal saldo l'app propone il numero minimo di pagamenti per pareggiare; "Registra pareggio" salva un giroconto con `settlement` che porta il saldo a zero. Nessuna nuova collezione, nessuna migrazione, nessuna route nuova sul server: tutto stava già nello spec 0002.

## Requirements

**User stories**:
- Come membro, voglio registrare un giroconto (dal conto personale al conto comune, o al conto del partner) senza che cambi entrate e uscite.
- Come coppia, vogliamo vedere chi deve quanto a chi, con il dettaglio di come si arriva a quel numero.
- Come membro, voglio registrare il pareggio con un tocco e vedere il saldo tornare a zero.
- Come famiglia, vogliamo che l'app riconosca una spesa e un'entrata uguali su due conti nostri come un giroconto (utile soprattutto con l'import, feature 11).

**Acceptance criteria**:
- **AC-1**: modulo del movimento con tipo "Giroconto": importo, data, "Dal conto", "Al conto" (diversi), descrizione; niente categoria, destinatario né divisione. Anche la modifica di un giroconto esistente usa questo modulo; `settlement` resta com'era. Due conti uguali → errore "Scegli due conti diversi".
- **AC-2**: un giroconto vale zero in `signedCents` e `totalsOf`: entrate, uscite e netto del registro non cambiano (già vero, ora coperto da test end to end).
- **AC-3**: parte di un conto: `ownerMemberId` del conto; un conto senza proprietario è la cassa comune, che vale per i membri secondo `families.defaultSplit` (importo diviso con `allocateShares`).
- **AC-4**: saldo per membro, in centesimi, positivo = gli altri gli devono soldi. Per ogni movimento condiviso:
  - spesa: chi ha pagato (`payerMemberId`, null = cassa comune) +importo; ogni membro −sua quota (`memberAmounts`);
  - entrata: chi l'ha ricevuta (`payerMemberId`, null = cassa comune) −importo; ogni membro +sua quota;
  - rimborso (`isRefund`): gli stessi termini con il segno opposto;
  - giroconto: parte del conto di origine +importo, parte del conto di arrivo −importo; se ha `settlement`, le parti sono `fromMemberId` e `toMemberId`; tra conti dello stesso membro vale zero.
  - I movimenti privati non contano (sono sempre a zero), così il saldo è lo stesso per chiunque lo guardi. La somma dei saldi è sempre esattamente zero.
- **AC-5**: dettaglio per membro: spese pagate, quota delle spese, entrate ricevute, quota delle entrate, giroconti dati meno ricevuti, saldo; il saldo è la somma con i segni di AC-4.
- **AC-6**: saldo a una data ("Saldo al", predefinito oggi) e per un periodo ("Dal", facoltativo): con "Dal" vuoto il saldo comprende tutto fino a "Saldo al"; con "Dal" mostra quanto si è mosso nel periodo.
- **AC-7**: pagamenti per pareggiare: il numero minimo di pagamenti (esatto fino a 12 membri con saldo non zero, poi greedy), ognuno dal debitore al creditore; con due membri al massimo uno. Ordine stabile (importo decrescente, poi `memberId`).
- **AC-8**: "Registra pareggio" su un pagamento proposto apre una conferma con importo (modificabile, > 0), data (oggi), conto di origine (predefinito: primo conto attivo condiviso del debitore, altrimenti il primo diverso) e di arrivo (del creditore); salva un giroconto con `settlement: { fromMemberId: debitore, toMemberId: creditore }`. Dopo il salvataggio dell'importo proposto il saldo dei due è zero.
- **AC-9**: riconoscimento: `findTransferPairs` trova coppie spesa e entrata (non rimborsi, condivise, non giroconti) con lo stesso importo, su due conti diversi della famiglia, a non più di 3 giorni; una coppia per movimento, prima le date più vicine. `mergeTransferPair` le unisce in un giroconto (conto della spesa → conto dell'entrata, data e descrizione della spesa, impronte di import unite). La pagina del saldo mostra "Giroconti da riconoscere" con "Unisci", che con un `commit` toglie i due movimenti e scrive il giroconto.
- **AC-10**: pagina `/saldo` ("Saldo tra i membri"), raggiungibile da Panoramica e Altro: frase per ogni pagamento ("Bruno deve 12,34 € ad Anna"), "Siete in pari" se tutto è zero, tabella del dettaglio, stati di caricamento, vuoto ed errore; saldo negativo con `--color-danger-text` e un'icona (design.md).

## Decision

**Chosen option**: Option 1: saldo calcolato alla lettura in `core` dai movimenti visibili, cassa comune ripartita con la divisione della famiglia, pareggio salvato come giroconto con `settlement`.

Il saldo non si salva mai: si ricava dai movimenti, come il saldo dei conti. Il server non cambia (giroconti e `settlement` sono già validati da schema, invarianti e regole Firestore).

**Implementation skills**: nessuna skill di stack installata.

## Feature design

**Data model sketch**: nessuna modifica. Si usano `transactions.type = "transfer"`, `toAccountId`, `settlement`, `importFingerprints` (fino a 2), `accounts.ownerMemberId`, `families.defaultSplit`. Chiude il follow-up dello spec 0002: un giroconto tra conti di membri diversi senza `settlement` conta nel saldo.

**Funzioni di `core`** (`packages/core/src/balance.ts` e `packages/core/src/transfers.ts`, tutte pure):
- `partyOf(accountId, accounts)`: `memberId` o `null` (cassa comune).
- `memberBalances(txs, { accounts, family, members, range? })`: `{ rows: BalanceRow[], totalCents }` con `BalanceRow = { memberId, paidCents, expenseShareCents, receivedCents, incomeShareCents, transfersCents, netCents }` (AC-3..AC-6).
- `settlementPlan(nets)`: `{ fromMemberId, toMemberId, amountCents }[]` (AC-7).
- `settlementTransfer(payment, { id, date, accounts })`: `Result` con il documento del giroconto o `no_accounts` (AC-8).
- `findTransferPairs(txs, { accounts, maxDays = 3 })` e `mergeTransferPair(pair, id, accounts)` (AC-9).

**API surface**: nessun endpoint nuovo. Si usano `commit` e `put` del `DataAdapter` già esistenti.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Nuovo giroconto | `visibility`, `ownerMemberId`, `payerMemberId` | `accountDefaults(from, to)` |
| Modifica giroconto | `settlement`, impronte, provenienza | il documento salvato (resta) |
| Saldo | movimenti | `useAllDocs(transactions)` filtrati per data in `core` |
| Parte della cassa comune | quote | `families.defaultSplit` di oggi |
| Nomi | membri | collezione `members` |
| Pagamenti proposti | importi | `settlementPlan(rows.netCents)` |
| Pareggio | giroconto | `settlementTransfer`, conti scelti nella conferma |
| Giroconti da riconoscere | coppie | `findTransferPairs` su tutti i movimenti |

**Key invariants**: somma dei saldi = 0 al centesimo; un giroconto non tocca `totalsOf`; il saldo non dipende da chi guarda (privati esclusi); `settlement` con due membri diversi; il piano di pareggio, applicato, porta ogni saldo a zero.

**Security model**: nessun cambio. Ogni membro attivo scrive giroconti condivisi; un giroconto è privato solo se entrambi i conti sono privati dello stesso membro (regola già in essere).

**Critical test scenarios**:
- Giroconto nel registro: totali invariati, verifica **AC-2**.
- Spesa 100,01 € pagata da Anna al 60/40 → Bruno deve 40,00 €; rimborso uguale → zero, verifica **AC-4**.
- Cassa comune 50/50: Anna versa 1000 €, si spendono 1000 € al 50/50 → Bruno deve 500 € ad Anna, verifica **AC-3**.
- Entrata di Bruno divisa 50/50 → Bruno deve metà ad Anna; giroconto tra membri senza `settlement` sposta il saldo, verifica **AC-4**.
- Somma zero e dettaglio coerente su dati casuali (proprietà), verifica **AC-5**.
- Saldo al giorno e periodo, verifica **AC-6**.
- Piano: 3 membri con una coppia a somma zero → 2 pagamenti, non 3; applicarlo azzera tutto, verifica **AC-7**.
- Pareggio salvato via adapter (contract suite) → saldo zero, verifica **AC-8**.
- Coppie: stesso importo, entro 3 giorni, conti diversi; una sola per movimento; fuori finestra nessuna, verifica **AC-9**.

## Build plan

Ordine Tracer Bullet: prima il saldo con il pareggio da un capo all'altro, poi il modulo dei giroconti, poi il riconoscimento.

1. [x] `core`: `memberBalances`, `settlementPlan`, `settlementTransfer`, `findTransferPairs`, `mergeTransferPair`, con test, satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-9**
2. [x] Dati: contract suite gruppo `balance` (giroconto con `settlement` salvato e riletto, saldo a zero dopo il pareggio, giroconto non cambia i totali) su memory e http; firebase con lo stesso codice (non verificato: serve Java 21), satisfies **AC-2**, **AC-8**
3. [x] Web: pagina `/saldo` con frasi, dettaglio, date, "Registra pareggio" e "Giroconti da riconoscere", link da Panoramica e Altro, satisfies **AC-6**, **AC-8**, **AC-9**, **AC-10**
4. [x] Web: tipo "Giroconto" nel modulo nuovo e modifica (`buildTransfer`), registro con "Modifica" anche per i giroconti, satisfies **AC-1**, **AC-2**

## Consequences

**Positive**:
- Un solo calcolo per i due backend; il saldo è sempre coerente con i movimenti, niente totali salvati da tenere allineati.
- Il pareggio è un movimento normale: si vede nel registro, si modifica o si elimina come gli altri.
- Il riconoscimento è puro e pronto per l'import del feature 11.

**Negative / tradeoffs**:
- La cassa comune usa la divisione della famiglia di oggi: cambiarla ricalcola anche il saldo passato della cassa.
- Il saldo legge tutti i movimenti visibili (come la riapplicazione); con molti anni di dati il primo caricamento è più lento.
- Oltre 12 membri con saldo non zero il piano è greedy (al più n − 1 pagamenti, non sempre il minimo).

## Follow-up

- [x] Feature 11: passare le righe importate da `findTransferPairs` prima di salvarle (spec 0006, AC-13).
- [ ] Feature 14: riusare `memberBalances` nella dashboard; feature 19: soglia di `settings.notifications.settlement`.
- [ ] Valutare una divisione propria per ogni conto comune, se la famiglia ne ha più d'uno con quote diverse.

## Rationale

Vedi [rationale.md](rationale.md).
