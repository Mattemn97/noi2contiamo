# 0006. Import CSV: lettura nel browser con `core`, profili salvati, lotti annullabili

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Il file CSV della banca si legge tutto nel browser, con funzioni pure di `packages/core`: codifica, separatore, righe da saltare, date italiane, importi con la virgola e segni diversi. Una procedura guidata in cinque passi (file, colonne, anteprima, conferma, risultato) ti fa mappare le colonne una volta; il profilo salvato si riconosce da solo dall'intestazione del file successivo. Ogni riga ha un'impronta (spec 0002), così i movimenti già presenti non si duplicano; ogni import è un lotto che puoi annullare. Il server non legge mai il CSV: riceve solo documenti normali (`importProfiles`, `importBatches`, `transactions`) con il `commit` che esiste già.

## Requirements

**User stories**:
- Come membro, voglio caricare l'estratto CSV della mia banca o di un servizio (Revolut, PayPal, Satispay) e vedere i movimenti prima di salvarli.
- Come membro, voglio mappare le colonne una sola volta e salvare il profilo, così il prossimo file della stessa banca si importa senza rimappare.
- Come membro, voglio che reimportare un file (o un file che si sovrappone al precedente) non crei doppioni.
- Come membro, voglio annullare un import sbagliato con un tocco.
- Come coppia, vogliamo che un bonifico tra due conti nostri importato dalle due banche diventi un giroconto.

**Acceptance criteria**:
- **AC-1**: codifica: un file con BOM UTF-8 o UTF-8 valido si legge come UTF-8 (BOM tolto); altrimenti come Windows-1252 (`è`, `à`, `€` corretti). Il profilo può fissare `utf-8`, `windows-1252` o `iso-8859-1`.
- **AC-2**: CSV: separatore `;`, `,` o tabulazione riconosciuto da solo (il più costante nelle prime 10 righe non vuote, a pari merito `;` poi `,` poi tab); campi tra virgolette con separatori, a capo e `""` dentro; righe vuote ignorate; fine riga CRLF o LF.
- **AC-3**: righe da saltare: l'intestazione si trova da sola (prima riga, entro le prime 20, con almeno 2 celle piene seguita da una riga con una data leggibile); l'utente può cambiarla. Senza intestazione le colonne si chiamano "Colonna 1", "Colonna 2", ...
- **AC-4**: date: formati `dd/MM/yyyy`, `d/M/yyyy`, `dd-MM-yyyy`, `dd.MM.yyyy`, `yyyy-MM-dd`, `dd/MM/yy`, `MM/dd/yyyy`; un orario dopo la data si ignora; una data impossibile (31/02) è un errore di riga. Il formato si propone da solo (il primo della lista, in quest'ordine, che legge tutti i campioni).
- **AC-5**: importi: virgola o punto decimale, separatore delle migliaia `.`, `,`, spazio o nessuno; `€`, `EUR`, spazi e `+` ignorati; meno davanti o dietro, segno meno Unicode e parentesi danno un negativo. Si converte in centesimi interi senza passare dai decimali; più di 2 cifre decimali, testo non numerico o importo zero sono errori di riga. Il formato si propone dai campioni.
- **AC-6**: segno: `negativeIsExpense` (una colonna, negativo = spesa), `positiveIsExpense` (carte), `debitCreditColumns` (colonne Dare e Avere: valore in Dare = spesa, in Avere = entrata, il segno scritto si ignora; tutte e due piene o tutte e due vuote = errore), `typeColumn` (colonna tipo con valori di spesa e di entrata; valore sconosciuto = errore).
- **AC-7**: mappatura proposta dai nomi delle colonne (data, descrizione, importo, dare, avere, destinatario, tipo, in italiano e in inglese); descrizione da una o più colonne unite con " · "; l'utente cambia ogni scelta.
- **AC-8**: profili: "Salva profilo" (con nome) salva tutte le scelte e `headerSignature`; al file successivo, se un profilo salvato legge un'intestazione con la stessa firma, viene scelto da solo (a parità vince quello con `defaultAccountId` uguale al conto scelto, poi il più recente) e si salta il passo delle colonne. Si può aggiornare un profilo esistente.
- **AC-9**: anteprima: ogni riga con stato `nuova`, `doppione`, `errore` (con il motivo in italiano e il numero di riga del file) o `giroconto`; contatori per stato; si importano solo le nuove (e i giroconti scelti). Niente da importare → conferma disabilitata.
- **AC-10**: doppioni: impronta `importFingerprint` (spec 0002) per ogni riga valida, con l'indice di occorrenza nello stesso file (due righe identiche nello stesso file sono due movimenti diversi). Una riga è doppione se la sua impronta è già su un movimento visibile della famiglia. Reimportare lo stesso file dà zero nuove righe; un file che si sovrappone importa solo la parte nuova. Lo stesso `fileHash` di un lotto precedente mostra un avviso (non blocca).
- **AC-11**: lotto: la conferma scrive in un `commit` (spezzato a 500 con `chunkOps`) il profilo (se salvato), il lotto `importBatches` (conteggi, date da/a, `fileHash` SHA-256), i destinatari nuovi e i movimenti con `importBatchId`, `importFingerprints`, divisione automatica (`autoSplit`), visibilità e pagatore dal conto (`accountDefaults`), provenienza `import` per il destinatario letto dal file.
- **AC-12**: annullare: "Annulla import" su un lotto, dopo una conferma, toglie i movimenti con quel `importBatchId` e poi il lotto; dopo l'annullamento lo stesso file si reimporta di nuovo. Il server rifiuta di cancellare un lotto che ha ancora movimenti (`409 in_use`).
- **AC-13**: giroconti: le righe nuove passano da `findTransferPairs` (spec 0005) insieme ai movimenti esistenti condivisi di altri conti entro 3 giorni; una coppia nuova ↔ esistente si propone come giroconto (scelta attiva di default, si può togliere): il movimento esistente diventa il giroconto (`mergeTransferPair`, stesso id e lotto del movimento esistente, impronte unite) e la riga nuova non si salva a parte.
- **AC-14**: aggancio per le regole (feature 12): `planImport` accetta `hook?: ImportHook`, una funzione pura `(tx, row) => tx` applicata a ogni movimento nuovo dopo i valori di default e prima del riconoscimento dei giroconti; senza hook non cambia niente.
- **AC-15**: server: `importProfiles` e `importBatches` si leggono, scrivono e cancellano con le route generiche; un riferimento a conto, profilo o lotto inesistente è `422`; cancellare un conto usato da lotti o profili, o un profilo usato da lotti, è `409 in_use`.
- **AC-16**: interfaccia in italiano su `/importa` (da Movimenti e da Altro): passi File → Colonne → Anteprima → Conferma → Risultato, storico dei lotti con "Annulla import"; file oltre 5 MB o 5000 righe rifiutato con un messaggio; tutto usabile da tastiera e da telefono.

## Decision

**Chosen option**: Option 1: lettura e piano dell'import in `core` nel browser, scrittura con il `commit` generico del `DataAdapter`.

Il server resta sottile: valida forma e riferimenti dei nuovi documenti e tiene il vincolo unico delle impronte; tutta la logica del CSV vive in `packages/core/src/import/`.

**Implementation skills**: nessuna skill di stack installata.

## Feature design

**Data model sketch**: nessuna nuova collezione né migrazione: `importProfiles`, `importBatches`, `transactions.importBatchId`, `transactions.importFingerprints` e la tabella `transaction_fingerprints` esistono già (spec 0002). Il server aggiunge solo i modelli Pydantic e le voci nel suo registro per le due collezioni. Firestore: due indici per cercare le impronte (`visibility` + `importFingerprints` array, `ownerMemberId` + `visibility` + `importFingerprints` array).

**Moduli di `core`** (`packages/core/src/import/`, tutti puri):
- `decode.ts`: `detectEncoding(bytes)`, `decodeBytes(bytes, encoding)` (UTF-8 e Windows-1252 scritti a mano, niente API del browser), `fileHash(bytes)`.
- `csv.ts`: `detectDelimiter(text)`, `parseCsv(text, { delimiter, quote })` → `string[][]`.
- `numbers.ts`: `parseAmount(raw, fmt)` → `Result<number, string>` (centesimi con segno), `detectNumberFormat(samples)`.
- `dates.ts`: `parseDate(raw, pattern)` → `Result<IsoDate, string>`, `detectDateFormat(samples)`, `DATE_FORMATS`.
- `profile.ts`: `ProfileSettings` (il profilo senza id, nome e audit), `detectHeaderRow(rows)`, `headerSignature(headers)`, `guessSettings(text)` (codifica a parte), `matchProfile(bytes, profiles, accountId)`.
- `rows.ts`: `readRows(text, settings)` → `{ headers, rows: ParsedRow[] }` con `ParsedRow = { line, ok: true, date, signedCents, description, payee } | { line, ok: false, error }`.
- `plan.ts`: `planImport(input)` → `{ items: PlanItem[], counts, batch, ops }`; `undoImportOps(batch, txs)` → `CommitOp`.
- `ImportHook = (tx: WriteDocOf<"transactions">, row: ValidRow) => WriteDocOf<"transactions">`.

**API surface**: nessun endpoint nuovo. `GET/PUT/DELETE /families/{f}/importProfiles|importBatches/{id}` e `POST /families/{f}/commit` (generiche).

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Lettura file | testo | `decodeBytes(bytes, settings.encoding)`, codifica da `detectEncoding` o dal profilo |
| Lettura file | separatore, righe da saltare, formati, mappatura | profilo riconosciuto (`matchProfile`) o `guessSettings`, poi l'utente |
| Anteprima | data, importo, descrizione, destinatario | `readRows` con le impostazioni scelte |
| Anteprima | stato doppione | impronte dei movimenti visibili tra `dateFrom` e `dateTo` delle righe (tutti i conti: l'impronta contiene già il conto) |
| Anteprima | giroconti proposti | `findTransferPairs` su righe nuove + movimenti condivisi di altri conti tra `dateFrom − 3` e `dateTo + 3` |
| Anteprima | avviso file già importato | `fileHash` confrontato con `importBatches` |
| Conferma | `type`, `amountCents` | segno di `signedCents` (negativo = spesa), valore assoluto |
| Conferma | `visibility`, `ownerMemberId`, `payerMemberId` | `accountDefaults(account)` |
| Conferma | `split` | `autoSplit` con `categoryId: null` (entrata sul conto di un membro → quel membro, altrimenti famiglia) |
| Conferma | `categoryId` | null (la mettono le regole del feature 12 tramite `hook`) |
| Conferma | `payeeId` | destinatario esistente con lo stesso `normalize`, altrimenti nuovo con `payeeFromName` nello stesso commit |
| Conferma | `provenance` | `{ category: "default", payee: "import" se dal file, altrimenti "default", split: "default" }` |
| Conferma | lotto `rowCount`, `importedCount`, `duplicateCount`, `dateFrom`, `dateTo`, `importedAtMs` | righe del file non vuote, righe salvate (giroconti uniti compresi), doppioni, date min e max delle righe valide, orologio del browser |
| Conferma | `profileId` | profilo usato o appena salvato, altrimenti null |
| Salva profilo | `headerSignature` | `headerSignature(intestazione letta)`; null senza intestazione |
| Salva profilo | `defaultAccountId` | il conto scelto nel passo File |
| Annulla | movimenti da togliere | `list(transactions, where importBatchId)` tutte le pagine |

**Key invariants**: importi sempre interi in centesimi (nessun `parseFloat`); un'impronta compare al massimo una volta per famiglia; nel `commit` il lotto viene prima dei movimenti (chiave esterna nel server) e i movimenti vengono tolti prima del lotto; il CSV non lascia mai il browser.

**Security model**: nessun cambio: ogni membro attivo legge e scrive profili e lotti della sua famiglia (regole Firestore e server già in essere); i movimenti seguono la visibilità del conto; l'annullamento tocca solo i movimenti che chi annulla vede.

**Critical test scenarios**:
- Fixture Intesa (Windows-1252, `;`, 3 righe di preambolo, Addebiti/Accrediti, `1.234,56`): righe lette con accenti giusti, verifica **AC-1**, **AC-3**, **AC-5**, **AC-6**.
- Fixture Revolut (UTF-8, `,`, data con orario, `-12.50`, descrizione tra virgolette con virgola), verifica **AC-2**, **AC-4**, **AC-5**.
- Fixture PayPal (BOM, tutto tra virgolette, `-1.234,56`), verifica **AC-1**, **AC-2**, **AC-5**.
- Fixture Satispay (colonna tipo, importi positivi, `dd-MM-yyyy`), verifica **AC-6**.
- Righe con data impossibile, importo testuale, Dare e Avere pieni: errori di riga con il numero giusto, verifica **AC-9**.
- Stesso file due volte: seconda volta zero nuove, tutte doppioni; due righe identiche nello stesso file: due movimenti, verifica **AC-10**.
- Profilo salvato riconosciuto sul secondo file, anche con un'altra codifica di default; conflitto risolto dal conto, verifica **AC-8**.
- Commit del piano su memory e http (contract suite gruppo `import`), annullamento, reimport, `409` sul lotto con movimenti, verifica **AC-11**, **AC-12**, **AC-15**.
- Spesa importata da Intesa + entrata esistente su Revolut stesso importo → giroconto unito, verifica **AC-13**.
- Hook che mette una categoria: il movimento la porta, verifica **AC-14**.
- Procedura guidata in jsdom: carica, salva profilo, conferma, risultato; secondo file salta le colonne, verifica **AC-8**, **AC-16**.

## Build plan

Ordine Tracer Bullet: prima un filo che importa davvero un file da capo a fondo (core minimo, dati, pagina), poi si ispessisce.

1. [x] `core`: decodifica, CSV, date, importi, righe, profilo (firma, intestazione, proposta), con le 4 fixture, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**
2. [x] `core`: `planImport` (doppioni, lotto, destinatari, divisione, giroconti, hook) e `undoImportOps`, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**
3. [x] Dati: server (modelli Pydantic, registro, riferimenti, `in_use`), memory (`in_use`), firebase (impronte e `in_use`, indici), contract suite gruppo `import`, satisfies **AC-10**, **AC-11**, **AC-12**, **AC-15**
4. [x] Web: `/importa` con i cinque passi, "Salva profilo", storico con "Annulla import", link da Movimenti e Altro, satisfies **AC-8**, **AC-9**, **AC-12**, **AC-16**

## Consequences

**Positive**:
- Un solo lettore CSV per i due backend; si prova con test puri sulle fixture.
- Il server e le regole Firestore quasi non cambiano: i documenti c'erano già.
- Il feature 12 si aggancia con una funzione, senza toccare la procedura guidata.

**Negative / tradeoffs**:
- Il file deve stare in memoria nel browser (limite 5 MB / 5000 righe).
- In Firestore un import oltre 500 operazioni non è atomico nel suo insieme; il lotto viene scritto per primo, quindi un import interrotto lascia un lotto con meno movimenti (si annulla o si reimporta: le impronte evitano i doppioni).
- Un giroconto unito a un movimento esistente resta dopo l'annullamento del lotto nuovo (il movimento esistente era già lì); l'impronta della riga resta sul giroconto, quindi reimportare non lo duplica.
- In Firestore l'unicità delle impronte la controlla l'adapter prima di scrivere, non una regola: due import contemporanei dello stesso file potrebbero passare entrambi.

## Follow-up

- [ ] Feature 12: passare il motore delle regole come `hook` di `planImport`.
- [ ] Feature 19: promemoria "import da fare" sulla data dell'ultimo lotto.
- [ ] Valutare formati di file oltre il CSV (XLSX di alcune banche) solo se servono davvero.

## Rationale

Vedi [rationale.md](rationale.md).
