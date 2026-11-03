# 0004. Divisione spese: quote per membro risolte in `core`, salvate come fotografia

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Ogni entrata e ogni spesa porta con sé la sua divisione tra i membri, in percentuale (punti base, 10000 = 100%) oppure in importi fissi in centesimi. Se non la scrivi a mano, l'app la prende in quest'ordine: regola automatica (arriva col feature 12), categoria (o la sua categoria principale), divisione predefinita della famiglia. La divisione si salva sul movimento al momento della scrittura (una fotografia): cambiare la categoria o la famiglia non tocca i movimenti vecchi, a meno che tu non chieda di riapplicarla. Tutti i calcoli stanno in `packages/core`; i backend salvano e controllano soltanto.

## Requirements

**User stories**:
- Come membro, voglio che una spesa senza indicazioni si divida secondo la sua categoria (affitto 60/40), così non devo pensarci ogni volta.
- Come membro, voglio dividere a mano un singolo movimento in percentuale o in euro, con scorciatoie 50/50 e 100% a una persona.
- Come famiglia, vogliamo una divisione predefinita comune e poterla riapplicare ai movimenti vecchi quando cambia.
- Come persona con un conto privato, voglio che i miei movimenti privati restino al 100% miei.

**Acceptance criteria**:
- **AC-1**: precedenza: divisione manuale > regola (feature 12) > categoria del movimento > categoria principale (per una sottocategoria senza divisione propria) > divisione predefinita della famiglia. `split.source` vale `manual`, `rule`, `category` o `default` di conseguenza. Eccezione per le entrate: un'entrata su un conto personale senza divisione di categoria va al 100% al proprietario del conto (`source: "default"`).
- **AC-2**: un movimento privato ha sempre la divisione al 100% sul proprietario (`kind: "bp"`, `source: "default"`), qualunque cosa dicano categoria, famiglia o modulo; il modulo non mostra l'editor ma la frase "Movimento privato: tutto a te".
- **AC-3**: arrotondamento: l'importo di ogni membro si calcola solo con `allocateShares` (resto più grande, pareggi al `memberId` minore) e la somma è sempre esattamente `amountCents`. Esempio: 100,01 € al 60/40 → 60,01 € e 40,00 €; 0,01 € al 50/50 → 0,01 € al membro con id minore. Una divisione in centesimi deve sommare esattamente all'importo, altrimenti il modulo la rifiuta e mostra quanto manca o avanza.
- **AC-4**: modulo del movimento: editor con modalità "Percentuale" o "Importo", una riga per ogni membro attivo (più i membri usciti già presenti nella divisione), scorciatoie "50/50" (parti uguali tra i membri attivi) e "Tutto a {nome}" per ogni membro, anteprima degli importi per membro, pulsante "Torna automatica". Salvando con l'editor aperto la divisione è `source: "manual"` e `provenance.split: "manual"`.
- **AC-5**: fotografia: cambiare la divisione di una categoria o della famiglia non cambia i movimenti già salvati. Modificando un movimento in modalità automatica senza cambiare categoria né conto, la divisione salvata resta quella; se cambiano categoria o conto si risolve di nuovo. Una divisione manuale resta manuale; se è in centesimi e l'importo cambia, il modulo chiede di correggerla.
- **AC-6**: riapplica: dalla categoria ("Riapplica ai movimenti") e dalla divisione della famiglia si possono riscrivere i movimenti esistenti con la nuova risoluzione. Si toccano solo entrate e spese condivise con `split.source` `category` o `default` (mai `manual` né `rule`) e solo quelli il cui risultato cambia; prima si mostra quanti sono e si chiede conferma; si scrive con `commit` a blocchi di 500.
- **AC-7**: divisione predefinita della famiglia in `/altro/famiglia`, modificabile da ogni membro attivo, in percentuale, con le stesse scorciatoie. Le chiavi devono essere membri attivi e sommare a 10000, altrimenti `invalid`; chi non è membro riceve `not_found`. Vale su memory, http e firebase (contract suite).
- **AC-8**: divisione predefinita di categoria per categorie di spesa e di entrata, con le stesse scorciatoie; una sottocategoria senza divisione propria dice "Usa quella di {principale}" se la principale ne ha una.
- **AC-9**: il registro mostra la divisione di ogni entrata e spesa come importi per membro ("Matteo 60,01 € · Giulia 40,00 €"), con "a mano" se manuale; i rimborsi usano la stessa risoluzione e mostrano le stesse quote (il segno lo applica il saldo del feature 10).

## Decision

**Chosen option**: Option 1: risoluzione pura in `core`, fotografia sul movimento, riapplicazione esplicita dal client.

La divisione si calcola in `core` al momento della scrittura e si salva in `transactions.split`; i backend la validano (somma, membri) ma non la calcolano. L'unica nuova API dei dati è `membership.setDefaultSplit`.

## Feature design

**Data model sketch**: nessuna nuova collezione e nessuna migrazione. Si usano i campi già fissati dallo spec 0002: `families.defaultSplit` (`SplitSpec`), `categories.defaultSplit` (nullable), `transactions.split` (`TransactionSplit`), `transactions.provenance.split`. Cambia solo il significato di `categories.defaultSplit: null` su una sottocategoria: eredita dalla principale, poi dalla famiglia.

**Funzioni di `core`** (`packages/core/src/split.ts`, tutte pure):
- `categorySplit(categoryId, categories)`: `defaultSplit` della categoria, altrimenti della principale, altrimenti null.
- `resolveSplit({ manual?, rule?, category?, family, privateOwner?, incomeOwner? })`: applica AC-1 e AC-2 e restituisce un `TransactionSplit`.
- `checkSplit(split, amountCents)`: `Result` con errore `empty` | `sum` (e la differenza in centesimi o punti base).
- `centsToBp(shares)` e `bpToCents(amountCents, shares)`: passaggio tra modalità dell'editor (resto più grande, somma esatta).
- `equalSplit(memberIds)` e `soloSplit(memberId)`: le scorciatoie.
- `reapplySplits(transactions, ctx)`: i movimenti che cambiano con la risoluzione attuale (AC-6).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/families/{familyId}/default-split` | PUT | `SplitSpec` (req) | `204` | sessione + CSRF, membro attivo | 404 non membro, 422 chiavi o somma |

`DataAdapter.membership.setDefaultSplit(familyId, split): Promise<Result<void, DataError>>`. Firebase: `updateDoc` di `families/{f}` con `defaultSplit` e audit; la regola ammette l'aggiornamento di soli `defaultSplit`, `updatedAtMs`, `updatedByMemberId` a ogni membro.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Nuovo movimento, automatico | `split` | `resolveSplit`: regola (futura) → `categorySplit` → (entrata su conto personale: proprietario) → `families.defaultSplit` |
| Nuovo movimento, manuale | `split` | editor del modulo, `source: "manual"` |
| Movimento privato | `split` | `{ [ownerMemberId]: 10000 }`, da `accountDefaults` |
| Modifica automatica, stessa categoria e conto | `split` | il valore salvato (fotografia) |
| Scorciatoia 50/50 | quote | `equalSplit` sui membri attivi (`leftAtMs === null`) |
| Anteprima e registro | importo per membro | `memberAmounts` (`allocateShares` per `bp`) |
| Riapplica | movimenti da riscrivere | `reapplySplits` sui movimenti visibili letti con `useAllDocs` |
| Divisione famiglia | `families.defaultSplit` | editor in `/altro/famiglia` → `setDefaultSplit` |
| Nomi nell'editor | membri | collezione `members` |

**Key invariants**: quote non negative, almeno un membro con quota > 0 nel modulo (le quote a zero si tolgono prima di salvare), somma 10000 o `amountCents`, chiavi membri della famiglia (attivi per la divisione della famiglia); privato = 100% proprietario; giroconti senza divisione.

**Security model**: ogni membro attivo modifica divisione della famiglia, delle categorie e dei movimenti condivisi; i movimenti privati restano del proprietario (regole già in essere). Nessun nuovo segreto.

**Critical test scenarios**:
- Precedenza: manuale batte categoria, sottocategoria eredita dalla principale, famiglia come ultimo, entrata su conto personale al proprietario, verifica **AC-1**, **AC-8**.
- Privato: categoria 50/50 su conto privato dà 100% al proprietario, verifica **AC-2**.
- Arrotondamento: 10001 al 6000/4000 → 6001/4000; 1 al 5000/5000 → 1 al membro minore; centesimi che non sommano → errore `sum`, verifica **AC-3**.
- Fotografia e riapplica: cambio categoria 60/40 → movimento vecchio invariato; riapplica cambia solo `category`/`default`, verifica **AC-5**, **AC-6**.
- Contract: `setDefaultSplit` valido, chiave non membro → `invalid`, altra famiglia → `not_found`, verifica **AC-7**.

## Build plan

Ordine Tracer Bullet: un filo completo (core → modulo → registro) per la divisione manuale, poi gli strati di default e la riapplicazione.

1. [x] `core`: `categorySplit`, `resolveSplit` esteso, `checkSplit`, `centsToBp`, `bpToCents`, `equalSplit`, `soloSplit`, `reapplySplits`, con test, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-6**
2. [x] Web: `buildTransaction` con divisione manuale o automatica, editor `SplitEditor` nel modulo, divisione nel registro, satisfies **AC-4**, **AC-5**, **AC-9**
3. [x] Dati: `membership.setDefaultSplit` su memory, http (route server + `gen:api`), firebase (adapter e regola), contract suite, satisfies **AC-7**
4. [x] Web: divisione della famiglia in `/altro/famiglia`, divisione delle categorie anche per le entrate con eredità, "Riapplica" con conferma, satisfies **AC-6**, **AC-7**, **AC-8**

## Consequences

**Positive**:
- Le quote sono esatte e uguali in ogni backend perché le calcola solo `core`.
- I movimenti vecchi non cambiano da soli: il saldo del feature 10 resta stabile.
- Le regole del feature 12 entrano nella stessa funzione senza cambiare il modello.

**Negative / tradeoffs**:
- La riapplicazione legge tutti i movimenti visibili e riscrive dal client; in Firestore oltre 500 movimenti non è atomica nel suo insieme.
- Un membro che entra dopo non è nella divisione della famiglia finché qualcuno non la cambia.

## Follow-up

- [ ] Feature 12: passare la `SplitSpec` della regola vincente a `resolveSplit` e riapplicare le regole senza toccare `manual`.
- [ ] Feature 10: il saldo tra membri usa `memberAmounts` con il segno di `signedCents`.
- [ ] Valutare un avviso quando la divisione della famiglia non include tutti i membri attivi.

## Rationale

Vedi [rationale.md](rationale.md).
