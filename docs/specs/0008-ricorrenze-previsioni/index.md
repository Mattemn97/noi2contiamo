# 0008. Ricorrenze e previsioni: scadenze calcolate in `core`, abbinamento derivato, previsione mensile

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Una ricorrenza (affitto, abbonamento, bolletta) è un documento `recurrences` già previsto dallo spec 0002. Le scadenze non si salvano mai: `core` le calcola da `frequency`, `startDate`, `endDate` o `count`. Un movimento reale chiude una scadenza in due modi: collegato (ha `recurrenceId` e `recurrenceDueDate`, scritto quando confermi) oppure abbinato in automatico (stesso conto e tipo, data nella finestra, importo nella tolleranza, stesso destinatario o descrizione). I suggerimenti si calcolano dallo storico; si salvano solo quelli scartati (`recurrenceDismissals`). La previsione è una funzione pura: saldo di oggi per conto, più le scadenze aperte, più la media delle spese e entrate variabili, mese per mese. Nessuna migrazione: si allarga solo il JSON di `frequency` con `count`.

## Requirements

**User stories**:
- Come coppia, vogliamo segnare affitto, bollette e abbonamenti una volta sola e vedere le prossime scadenze.
- Come membro, voglio che il pagamento importato chiuda da solo la scadenza, e poterlo correggere a mano.
- Come membro, voglio che l'app mi proponga i pagamenti che si ripetono già nello storico.
- Come coppia, vogliamo vedere quanto avremo sui conti nei prossimi mesi.

**Acceptance criteria**:
- **AC-1**: frequenza: `unit` `day`, `week`, `month` o `year` con `interval` ≥ 1 (settimanale = week 1, mensile = month 1, bimestrale = month 2, trimestrale = month 3, semestrale = month 6, annuale = year 1, personalizzata = qualsiasi unità e intervallo). Fine opzionale: `endDate` (compresa) e/o `frequency.count` (numero di scadenze, le saltate contano); vale la prima che arriva.
- **AC-2**: scadenze (`occurrences(rec, from, to)`): la n-esima si calcola sempre dall'inizio (`startDate` + n × intervallo), mai dalla precedente, così il 31 non scivola. Mese e anno: giorno `dayOfMonth` (se manca, quello di `startDate`), portato all'ultimo giorno se il mese è più corto (31 → 30 aprile, 28 o 29 febbraio; 29 febbraio annuale → 28 negli anni non bisestili, e torna 29 in quelli bisestili). Con `dayOfMonth` diverso dal giorno di inizio, le date prima di `startDate` non contano. Settimana e giorno: `startDate` + 7 × n × interval giorni (o n × interval). Massimo 1000 scadenze per chiamata.
- **AC-3**: abbinamento (`matchOccurrences`): un movimento chiude una scadenza se è collegato (`recurrenceId` = ricorrenza e `recurrenceDueDate` = data) oppure, senza collegamento, se: stesso `type`; stesso `accountId` (e `toAccountId` per un giroconto); data entro `matchWindowDays` dalla scadenza; importo entro la tolleranza (`|importo − atteso| × 10000 ≤ atteso × amountToleranceBp`); identità: `payeeId` uguale se la ricorrenza ne ha uno, `descriptionMatch` vero se c'è, altrimenti categoria uguale (se la ricorrenza ne ha una). Un movimento collegato ad altro non si abbina mai in automatico. Ogni movimento chiude al massimo una scadenza; le scadenze si servono in ordine di data e prendono il candidato più vicino per data, poi per importo, poi per `id`.
- **AC-4**: stato di ogni scadenza: `paid` (collegata o abbinata, con `match: "linked" | "auto"` e il movimento), `skipped` (data in `skippedDates`), `missed` (oggi è dopo la scadenza + finestra e non è pagata), `upcoming` (altrimenti). La ricorrenza archiviata non genera scadenze dopo `archivedAtMs`; lista e previsione la ignorano.
- **AC-5**: azioni su una scadenza: "Collega" sceglie un movimento (stesso conto e tipo, entro 31 giorni, non collegato) e scrive `recurrenceId` e `recurrenceDueDate`; "Conferma" scrive il collegamento dell'abbinamento automatico; "Scollega" li rimette a `null`; "Salta" e "Annulla salto" cambiano `skippedDates`; "Registra pagamento" crea il movimento alla data della scadenza con l'importo atteso (`paymentFromOccurrence`: categoria, destinatario, conto, divisione della ricorrenza o `autoSplit`, visibilità e pagatore da `accountDefaults`, provenienza `default`) già collegato. Tutto con un `commit`.
- **AC-6**: importo fisso o variabile: fisso = `amountToleranceBp` 0 (l'UI dice "Importo fisso"), variabile = tolleranza in percentuale (predefinita 10%). Per la previsione l'importo atteso è `expectedAmountCents` se fisso, altrimenti la media intera (arrotondata) degli ultimi 3 pagamenti abbinati, e `expectedAmountCents` se non ce ne sono.
- **AC-7**: suggerimenti (`detectRecurring(txs, recs, dismissals, today)`): sugli ultimi 13 mesi, entrate e spese non collegate e non abbinate a una ricorrenza attiva; gruppo = tipo + conto + identità (`payeeId`, altrimenti `normalize(payeeNameFromDescription(description) ?? description)` senza cifre); nel gruppo, fasce di importo (ordinati, si spezza dove il successivo supera il precedente di più del 25%). Una fascia è ricorrente se ha almeno 3 movimenti (2 per l'annuale, o se uno ha in `ruleIds` una regola con `actions.recurring`), la mediana degli intervalli in giorni cade in una frequenza nota (7±2 → week 1, 14±3 → week 2, 30±5 → month 1, 61±7 → month 2, 91±10 → month 3, 182±15 → month 6, 365±20 → year 1), almeno il 75% degli intervalli sta in quella banda, e l'ultimo movimento non è più vecchio di 2 intervalli + 10 giorni.
- **AC-8**: il suggerimento porta: chiave stabile (`key`, 32 esadecimali da `sha256(type|accountId|identità|fascia)` con fascia = ordine di grandezza della mediana in passi da 25%), nome proposto (destinatario o testo in "Iniziali Maiuscole"), frequenza, `dayOfMonth` (il giorno più frequente), `startDate` (il primo movimento), importo (mediana), tolleranza (fisso 0 se tutti uguali, altrimenti la deviazione massima arrotondata al 5% superiore, minimo 5%, massimo 50%), categoria più frequente, destinatario, i movimenti trovati e "segnalato da una regola" se vale. Si escludono le chiavi scartate e i gruppi già coperti (i loro movimenti si abbinano a una ricorrenza attiva). "Accetta" apre l'editor precompilato; salvando, i movimenti trovati che ora si abbinano vengono collegati nello stesso `commit`. "Scarta" scrive `recurrenceDismissals/{key}`.
- **AC-9**: saldo di oggi per conto (`accountBalances(accounts, txs, today)`): `initialBalanceCents` più i movimenti con data tra `initialBalanceDate` e oggi compresi (entrata +, spesa −, rimborso al contrario, giroconto − su origine e + su arrivo).
- **AC-10**: previsione (`forecast({ accounts, txs, recs, today, months })`, `months` 1..12, predefinito 6): per ogni conto non archiviato e per ogni fine mese da quello corrente a +months: saldo di oggi + scadenze `upcoming` (e `missed` del mese corrente no: si considerano saltate) con data tra domani e la fine del mese, con segno per tipo (giroconto sposta tra i due conti) + variabile media. Variabile = per conto, la media mensile intera degli ultimi 3 mesi interi di entrate e spese non giroconto e non chiuse da una ricorrenza, separata in entrate ed uscite; il mese corrente aggiunge solo quanto manca della media (`max(0, media − già fatto nel mese)`, per entrate e uscite separate). Famiglia = somma dei conti condivisi. Il risultato per ogni mese: saldo previsto, ricorrenti in entrata e uscita, variabili in entrata e uscita.
- **AC-11**: pagina "Ricorrenti" (`/ricorrenti`): lista delle ricorrenze attive con nome, frequenza in italiano, importo atteso (con "circa" se variabile), prossima scadenza, stato dell'ultima scadenza; sezione "In arrivo" (prossimi 30 giorni e le non pagate degli ultimi 60) con stato `StatusBadge` (Pagata, Saltata, Non pagata, In arrivo) e le azioni di AC-5. Editor `/ricorrenti/nuova` e `/ricorrenti/:id` con validazione in italiano, archivia ed elimina (eliminare scollega prima i movimenti nello stesso `commit`).
- **AC-12**: pagina "Suggerimenti" (`/ricorrenti/suggerimenti`): elenco dei suggerimenti con nome, frequenza, importo, numero di movimenti e date, "Accetta" e "Scarta".
- **AC-13**: pagina "Previsioni" (`/previsioni`): scelta dei mesi (3, 6, 12) e della vista (Famiglia o un conto); grafico a linee del saldo previsto con `ChartFrame` (una serie, un asse, tabella) e tabella mensile con saldo, ricorrenti e variabili; stati caricamento, vuoto ed errore.
- **AC-14**: dati: `recurrences` e `recurrenceDismissals` nel server con il modello Pydantic della stessa forma (anche `frequency.count`); il server rifiuta con 422 `invalid` un riferimento inesistente (conto, conto di arrivo, categoria, destinatario, membri della divisione) e un `recurrenceId` di movimento inesistente; forma di giroconto (con `toAccountId` diverso, senza categoria né divisione) o di entrata e spesa (senza `toAccountId`). Contract suite gruppo `recurrences` passa su memory e http; firebase con lo stesso codice (non verificato: serve Java 21).

## Decision

**Chosen option**: Option 1: scadenze e abbinamenti derivati in `core`, collegamento salvato solo quando l'utente conferma o registra.

Un modulo `packages/core/src/recurring/` (scadenze, abbinamento, stato, suggerimenti, saldi, previsione); i backend salvano soltanto documenti normali con `commit`. Nessuna route nuova.

**Implementation skills**: nessuna skill di stack installata.

## Rationale

Vedi [rationale.md](rationale.md).

## Feature design

**Data model sketch** (nessuna migrazione: tabelle `recurrences` e `recurrence_dismissals` già create in 0002; `frequency` è JSON):

| Entità | Campo | Tipo | Note |
|---|---|---|---|
| recurrences | come spec 0002 | | |
| | `frequency.count` | int 1..1000, opz. | nuovo, dentro il JSON |
| | forma | | giroconto: `toAccountId` ≠ `accountId`, `categoryId` e `split` null; altrimenti `toAccountId` null |
| recurrenceDismissals | `id` = `key` del suggerimento | 32 esadecimali | |
| transactions | `recurrenceId`, `recurrenceDueDate` | già esistenti | insieme o tutti e due null |

**State transitions**: scadenza `upcoming` → `paid` (abbinata o collegata) | `skipped` (Salta) | `missed` (passa la finestra); `paid` → `upcoming`/`missed` (Scollega); `skipped` → `upcoming`/`missed` (Annulla salto). Ricorrenza attiva → archiviata (`archivedAtMs`) → attiva.

**API surface** (core e DataAdapter):

| Superficie | Tipo | Key inputs | Key outputs | Key errors |
|---|---|---|---|---|
| `adapter.commit` put/remove `recurrences`, `recurrenceDismissals`, `transactions` | DataAdapter | documento intero | `Result<void>` | 422 `invalid`, 404 altra famiglia |
| `occurrences(rec, from, to)` | core | ricorrenza, intervallo | `IsoDate[]` | |
| `matchOccurrences(rec, dates, txs)` | core | | `OccurrenceMatch[]` | |
| `occurrenceStatuses(rec, txs, from, to, today)` | core | | `Occurrence[]` con stato | |
| `nextDue(rec, txs, today)` | core | | `Occurrence` o null | |
| `paymentFromOccurrence(rec, date, ctx)` | core | | movimento da scrivere | |
| `linkOps` / `unlinkOps` | core | movimento, ricorrenza, data | movimento aggiornato | |
| `detectRecurring(txs, recs, dismissals, rules, today)` | core | | `RecurringSuggestion[]` | |
| `recurrenceFromSuggestion(s)` | core | | bozza | |
| `recurrenceIssues(rec, ctx)` | core | bozza | messaggi in italiano | |
| `accountBalances(accounts, txs, today)` | core | | saldo per conto | |
| `forecast(input)` | core | | `ForecastMonth[]` per conto e famiglia | |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Lista, In arrivo | scadenze e stato | `occurrenceStatuses` sulle ricorrenze attive e i movimenti degli ultimi 13 mesi + 1 mese avanti |
| Suggerimenti | movimenti | `useTransactionsInRange` ultimi 13 mesi; regole da `rules`; scarti da `recurrenceDismissals` |
| Previsioni | saldo di oggi | `accountBalances` sui movimenti da `min(initialBalanceDate)` (periodo `all`) |
| Previsioni | media variabile | ultimi 3 mesi interi prima del mese corrente |
| Registra pagamento | divisione | `rec.split` se c'è, altrimenti `autoSplit` |
| Registra pagamento | visibilità e pagatore | `accountDefaults(account, toAccount)` |
| Editor | `dayOfMonth` | giorno di `startDate`, modificabile |
| Editor "Numero di volte" | `frequency.count` | campo numerico opzionale |
| Oggi | data | fuso del dispositivo (`todayIso`) |

**Key invariants**:
- Le scadenze sono una funzione pura dei campi della ricorrenza: stesse date ogni volta, mai salvate.
- Un movimento chiude al massimo una scadenza; collegato vince su automatico.
- Importi sempre in centesimi interi; medie con `Math.round`.
- Nessuna scrittura senza un'azione esplicita dell'utente (l'abbinamento automatico è solo calcolato).

**Security model**: ogni membro attivo legge e scrive le ricorrenze della sua famiglia (Firestore `sharedKeys` già in essere, server con isolamento 404). Abbinamenti e previsione vedono solo i movimenti che chi guarda può leggere. Il server controlla che i riferimenti siano della stessa famiglia.

**Configuration required**: nessuna.

**Critical test scenarios**:
- 31 gennaio mensile → 28 febbraio, 31 marzo, 30 aprile; 29 febbraio annuale → 28 febbraio 2025, 29 febbraio 2028, verifica **AC-2**
- Bimestrale con `count` 3 e `endDate`: si ferma alla prima, verifica **AC-1**
- Bolletta variabile di 80 € con tolleranza 20%: un movimento di 92 € 3 giorni dopo chiude la scadenza; uno di 120 € no, verifica **AC-3**, **AC-6**
- Due scadenze vicine e un movimento: lo prende solo la più vicina, verifica **AC-3**
- Netflix 12,99 ogni mese per 5 mesi → suggerimento mensile; dopo "Scarta" non torna, verifica **AC-7**, **AC-8**
- Previsione: saldo 1000 €, affitto 700 € il 5, media variabile −200 € → fine mese successivo 100 €, verifica **AC-10**
- Auth: ricorrenza in un'altra famiglia → 404; categoria inesistente → 422, verifica **AC-14**

## Build plan

Tracer Bullet: prima il filo ricorrenza → scadenza → movimento che la chiude attraverso `core`, dati e una pagina minima, poi suggerimenti e previsione.

1. [x] `core`: schema (`frequency.count`, forma), `occurrences`, `matchOccurrences`, `occurrenceStatuses`, `nextDue`, `paymentFromOccurrence`, `linkOps`, `recurrenceIssues`, test, satisfies **AC-1**..**AC-6**
2. [x] `core`: `detectRecurring`, `recurrenceFromSuggestion`, `accountBalances`, `forecast`, test, satisfies **AC-7**..**AC-10**
3. [x] Dati: `RecurrenceDoc` e `RecurrenceDismissalDoc` nel server con controllo riferimenti e forma, `gen:api`, contract suite gruppo `recurrences`, test pytest, satisfies **AC-14**
4. [x] UI: `/ricorrenti` (lista, in arrivo, azioni), editor, satisfies **AC-11**, **AC-5**
5. [x] UI: `/ricorrenti/suggerimenti` e `/previsioni` con grafico e tabella, satisfies **AC-12**, **AC-13**

## Consequences

**Positive**:
- Nessuna migrazione, nessuna route: il server resta un archivio di documenti.
- Le scadenze non vanno mai fuori sincrono: cambi la frequenza e le date si ricalcolano.
- Il feature 19 (notifiche) riusa `occurrenceStatuses` per i promemoria.

**Negative / tradeoffs**:
- Calcolo nel browser sui movimenti letti: con molti anni di storico la previsione legge "tutto" una volta (cache persistente, come il registro).
- L'abbinamento automatico può sbagliare con due pagamenti simili nello stesso giorno; "Collega" e "Scollega" correggono.

**Neutral**:
- Lo spec 0002 resta valido: `frequency` si allarga in modo compatibile.

## Follow-up

- [ ] Feature 19: promemoria `recurringDue` da `occurrenceStatuses` con `leadDays`.
- [ ] Possibile in futuro: collegamento automatico all'import, previsione per membro.
