# 0007. Regole automatiche: motore puro in `core`, prima regola vince per campo, mai sopra il manuale

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Una regola dice "se il movimento è così, allora mettigli questa categoria, questo destinatario, questa divisione" (oppure "è un giroconto", oppure "è un pagamento ricorrente"). Tutto il calcolo sta in una funzione pura di `packages/core`: la usano l'import (tramite l'aggancio `hook` dello spec 0006), il modulo del nuovo movimento (come suggerimento che puoi cambiare) e il pulsante "Applica ai movimenti esistenti" (con anteprima). Le regole si provano nell'ordine della lista: per ogni campo vince la prima che lo imposta, e un campo scritto a mano non viene mai toccato. Nessuna migrazione: la collezione `rules` esiste già (spec 0002), si allargano solo le sue condizioni e azioni.

## Requirements

**User stories**:
- Come membro, voglio che i movimenti importati prendano da soli categoria, destinatario e divisione, così non li sistemo uno per uno.
- Come membro, voglio che "PAGAMENTO POS ESSELUNGA 1234 MILANO" diventi il destinatario "Esselunga".
- Come membro, voglio creare una regola partendo da un movimento che ho appena sistemato.
- Come membro, voglio vedere quali movimenti prende una regola mentre la scrivo, e applicarla a quelli vecchi senza perdere le mie correzioni.
- Come coppia, vogliamo decidere l'ordine delle regole, perché l'ordine decide chi vince.

**Acceptance criteria**:
- **AC-1**: condizioni: tipo (`types`), conto (`accountIds`, vale il conto di origine o quello di arrivo di un giroconto), destinatario (`payeeIds`), chi ha pagato (`memberIds` su `payerMemberId`; la cassa comune, `null`, non corrisponde mai), descrizione (`description: { op, value }` con `op` `contains`, `startsWith`, `equals` o `pattern`), intervallo di importo (`amountMinCents`, `amountMaxCents`, estremi compresi, contano come una condizione sola). Il testo si confronta sempre normalizzato (`normalize`: minuscolo, senza accenti, spazi compressi) da tutte e due le parti.
- **AC-2**: `pattern` è un modello sicuro, non una regex: `*` = qualsiasi testo (anche vuoto), `?` = un carattere, tutto il resto è letterale; il modello deve coprire tutta la descrizione (`pos * esselunga*`). Si confronta con un algoritmo lineare (`wildcardMatch`), senza regex; un valore lungo al massimo 200 caratteri. Nessun testo utente diventa mai una regex.
- **AC-3**: combinazione: `conditions.match` `all` (predefinito: tutte vere) o `any` (almeno una vera) sulle condizioni presenti. Una regola ha almeno una condizione e almeno un'azione; una regola disabilitata (`enabled: false`) non si applica mai.
- **AC-4**: azioni: `categoryId`, `payeeId`, `split` (`SplitSpec` in punti base, somma 10000), `transferAccountId` (trasforma un'entrata o spesa in giroconto con quel conto: una spesa va da questo conto a quello, un'entrata da quello a questo; niente categoria né divisione, visibilità e pagatore da `accountDefaults`), `recurring: true` (segna il movimento come candidato ricorrente per il feature 13). `transferAccountId` non convive con `categoryId` né con `split`.
- **AC-5**: ordine e semantica: regole abilitate in ordine `order` crescente, poi `id`. Le condizioni si valutano sui valori del movimento prima di qualunque azione (le regole non si concatenano). Per ogni campo (categoria, destinatario, divisione, giroconto) vince la prima regola che corrisponde e lo imposta; le regole dopo possono ancora impostare gli altri campi. `recurring` si somma: basta una regola. `ruleIds` del movimento elenca, senza ripetizioni e nell'ordine, ogni regola che ha impostato qualcosa o segnato `recurring`.
- **AC-6**: un'azione che non si può applicare si salta, senza errore, e il campo resta libero per la regola dopo: categoria inesistente, archiviata o di tipo diverso dal movimento; destinatario inesistente; divisione con un membro non attivo; divisione su un movimento privato; azione su un giroconto (le regole toccano solo entrate e spese); `transferAccountId` inesistente, uguale al conto del movimento, o su un rimborso.
- **AC-7**: precedenza (spec 0004): manuale > regola > categoria > famiglia. Un campo con `provenance` `manual` non si sovrascrive mai. Se una regola mette la categoria ma non la divisione, e la divisione non è manuale, la divisione si risolve di nuovo con `autoSplit` sulla nuova categoria. Un campo impostato da una regola ha `provenance` `rule` (la divisione anche `split.source: "rule"`).
- **AC-8**: import: `planImport` riceve come `hook` il motore con le regole abilitate della famiglia; ogni movimento nuovo esce con categoria, destinatario, divisione o giroconto dalle regole, `provenance` e `ruleIds` corretti. Un destinatario letto dal file (`import`) si può sostituire da una regola. Senza regole l'import non cambia.
- **AC-9**: inserimento manuale: nel modulo del nuovo movimento, appena descrizione, conto, importo, tipo o destinatario cambiano, il motore propone categoria, destinatario e divisione per i campi che non hai ancora toccato, con l'avviso "Suggerito dalla regola «nome»". Cambiare un campo suggerito lo rende manuale e il suggerimento non torna su quel campo. Salvando, i campi rimasti come suggeriti hanno `provenance` `rule` e la regola entra in `ruleIds`. La modifica di un movimento esistente non propone niente. Il giroconto non si propone a mano.
- **AC-10**: "Applica ai movimenti esistenti": dalla lista delle regole (tutte, in ordine) o da una regola sola, si calcola con `core` l'elenco dei movimenti che cambiano davvero, con prima e dopo per campo; si mostra il numero e un'anteprima, poi si chiede conferma; si scrive con `commit` a blocchi di 500 (`chunkOps`). Non si tocca mai un campo `manual`; un giroconto da regola si applica solo se categoria, destinatario e divisione non sono `manual`; un campo impostato in passato da una regola che ora non corrisponde più resta com'è. Rifare l'operazione subito dopo dà zero cambi (idempotente).
- **AC-11**: prova e anteprima: l'editor mostra, mentre scrivi, quanti e quali movimenti (gli ultimi 12 mesi, i primi 50 in ordine di data) la regola prende, e per ognuno cosa cambierebbe applicando questa regola da sola; i movimenti con il campo `manual` appaiono come "lasciato com'è (modificato a mano)". Una regola non valida mostra il motivo e non si salva.
- **AC-12**: "Crea regola da questo movimento": dal dettaglio di un'entrata o spesa, si apre l'editor con: tipo del movimento; descrizione `contains` con la parola chiave dal testo (vedi AC-13), oppure il destinatario se c'è e la descrizione è vuota; azioni categoria, destinatario (quello proposto da AC-13 se il movimento non ne ha) e divisione se quella del movimento è manuale in punti base. Il destinatario proposto che non esiste si crea nello stesso `commit` della regola.
- **AC-13**: destinatario dalla descrizione (`payeeNameFromDescription`): toglie le parole bancarie iniziali (pagamento, pos, carta, addebito, sdd, bonifico, a favore di, prelievo, acquisto, contactless, del, n, op e simili, lista in `core`), poi prende al massimo 3 parole fino alla prima che contiene una cifra o un segno; il risultato in "Iniziali Maiuscole". `PAGAMENTO POS ESSELUNGA 1234 MILANO` → `Esselunga`; testo senza parole utili → nessuna proposta.
- **AC-14**: ordine nella lista: `/altro/regole` mostra le regole in ordine con nome, riassunto in italiano di condizioni e azioni, stato e avviso per i riferimenti mancanti; si riordina trascinando e con i pulsanti "Su" e "Giù" (da tastiera); il riordino riscrive `order` 0, 1, 2, ... solo dove cambia, in un `commit`. Una regola nuova va in fondo (`order` massimo + 1). Si può abilitare, disabilitare, duplicare, eliminare (con conferma).
- **AC-15**: dati: la regola passa lo schema zod in `core` e il modello Pydantic nel server (stessa forma); il server rifiuta con 422 `invalid` un riferimento a categoria, destinatario o conto inesistente della famiglia; in Firestore la forma la controlla `core` prima di scrivere (le regole Firestore controllano già chiavi e appartenenza). Contract suite gruppo `rules` passa su memory e http; firebase con lo stesso codice (non verificato: serve Java 21).

## Decision

**Chosen option**: Option 1: motore puro in `core` con "prima regola vince per campo".

Un solo modulo `packages/core/src/rules/` valuta, applica, prova e propone; import, modulo, anteprima e applicazione ai vecchi usano le stesse funzioni; i backend salvano soltanto.

## Rationale

Vedi [rationale.md](rationale.md).

## Feature design

**Data model sketch** (nessuna migrazione: colonne `conditions` e `actions` JSON già nella tabella `rules`, chiavi già ammesse in Firestore):

| Entità | Campo | Tipo | Note |
|---|---|---|---|
| rules | `id` | UUIDv7 | PK, per famiglia |
| | `name` | string 1..60 | |
| | `enabled` | bool, default true | |
| | `order` | int, default 0 | più basso vince |
| | `conditions.match` | `all` \| `any`, default `all` | nuovo |
| | `conditions.types` | TransactionType[] ≥1, opz. | |
| | `conditions.accountIds` | id[] ≥1, opz. | FK accounts (stessa famiglia) |
| | `conditions.payeeIds` | id[] ≥1, opz. | FK payees |
| | `conditions.memberIds` | id[] ≥1, opz. | nuovo, FK members |
| | `conditions.description` | `{ op: contains\|startsWith\|equals\|pattern, value 1..200 }`, opz. | `pattern` nuovo |
| | `conditions.amountMinCents` / `amountMaxCents` | int > 0, opz. | min ≤ max |
| | `actions.categoryId` | id, opz. | FK categories |
| | `actions.payeeId` | id, opz. | FK payees |
| | `actions.split` | `SplitSpec`, opz. | |
| | `actions.transferAccountId` | id, opz. | nuovo, FK accounts; esclude `categoryId` e `split` |
| | `actions.recurring` | `true`, opz. | nuovo |
| | audit | | |
| transactions | `provenance`, `ruleIds`, `split.source` | già esistenti | scritti dal motore |

Il candidato ricorrente non è un campo nuovo del movimento: è derivato (`ruleIds` contiene una regola con `actions.recurring`), il feature 13 lo legge così.

**State transitions**: regola `enabled` ↔ disabilitata; nessun altro stato.

**API surface** (nessuna route nuova; documenti normali con `commit`):

| Superficie | Tipo | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `adapter.commit` put/remove `rules` | DataAdapter | regola intera | `Result<void>` | membro attivo | 422 `invalid` (forma o riferimento), 404 altra famiglia |
| `adapter.query("rules", order_asc)` | DataAdapter | familyId | regole in ordine | membro attivo | 404 |
| `ruleMatches(rule, subject)` | core | regola, movimento | boolean | n/d | |
| `applyRules(tx, rules, ctx)` | core | movimento in scrittura, regole, `RuleContext` | movimento aggiornato + `RuleOutcome` per campo | n/d | |
| `ruleImportHook(rules, ctx)` | core | | `ImportHook` | n/d | |
| `suggestFromRules(subject, rules, ctx)` | core | valori del modulo | `{ categoryId?, payeeId?, split?, recurring? }` con l'id della regola per campo | n/d | |
| `planApplyRules(txs, rules, ctx)` | core | movimenti, regole | `RuleChange[]` (prima, dopo, campi) solo se cambiano | n/d | |
| `previewRule(rule, txs, ctx)` | core | bozza della regola | corrispondenze con esito per campo | n/d | |
| `ruleFromTransaction(tx, ctx)` | core | movimento | bozza di regola + destinatario da creare | n/d | |
| `payeeNameFromDescription(text)` | core | descrizione | nome o null | n/d | |
| `reorderRules(rules, from, to)` | core | | regole con `order` cambiato | n/d | |
| `ruleIssues(rule, ctx)` | core | bozza | messaggi in italiano | n/d | |

`RuleContext = { categories, payees, accounts, activeMemberIds, family }` (le stesse letture del modulo e dell'import).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Import | categoria, destinatario, divisione, giroconto | `applyRules` con le regole `enabled` lette da `query("rules")` |
| Import | divisione senza regola di divisione | `autoSplit` sulla categoria risultante (spec 0004) |
| Import / manuale | visibilità e pagatore di un giroconto da regola | `accountDefaults(from, to)` |
| Manuale | suggerimento e nome della regola | `suggestFromRules` + `rule.name` |
| Manuale | campi "toccati" | stato del modulo (il campo cambiato dall'utente) |
| Applica ai vecchi | movimenti da valutare | `useTransactionsInRange` su "tutto" (periodo `all`, spec 0002 strategia letture) |
| Anteprima editor | movimenti degli ultimi 12 mesi | `periodRange` da oggi nel fuso del dispositivo |
| Lista | riassunto in italiano | `describeRule` in web, testi da `it.ts` |
| Lista | riferimento mancante | id non presente in categorie, destinatari, conti, membri attivi |
| Riordino | nuovo `order` | `reorderRules` (indice nella lista) |
| Nuova regola | `order` | massimo `order` esistente + 1 (0 se vuota) |
| Crea da movimento | parola chiave e destinatario | `payeeNameFromDescription(tx.description)` |
| Ogni campo scritto | `provenance`, `ruleIds` | `applyRules` |

**Key invariants**:
- Un campo `manual` non cambia mai per una regola, in nessun percorso.
- Stessi input, stesso risultato: l'ordine è `order` poi `id`; applicare due volte non cambia niente.
- Le quote restano esatte: la divisione della regola è `SplitSpec` (10000 bp); i centesimi si calcolano con `allocateShares` come oggi.
- Il movimento dopo le regole passa `transactionShapeIssues` (un giroconto senza categoria né divisione, privato solo se lo sono tutti e due i conti).
- Nessuna regex costruita dal testo utente.

**Security model**: ogni membro attivo legge e scrive le regole della sua famiglia (Firestore `sharedKeys` e server già in essere, isolamento con 404). Applicare le regole tocca solo i movimenti che chi applica vede (i privati dell'altro non arrivano nemmeno al client). Il server controlla che i riferimenti siano della stessa famiglia. Nessun segreto, nessuna variabile d'ambiente.

**Configuration required**: nessuna.

**Critical test scenarios**:
- Happy path: import della fixture con una regola "esselunga" → categoria Spesa, destinatario Esselunga, divisione 60/40 `rule`, verifica **AC-8**, **AC-5**, **AC-7**
- Ordine: due regole che mettono la categoria, vince quella con `order` più basso; dopo il riordino vince l'altra, verifica **AC-5**, **AC-14**
- Manuale: "Applica ai vecchi" su un movimento con categoria `manual` lascia la categoria e cambia solo il destinatario `import`; seconda applicazione zero cambi, verifica **AC-10**, **AC-7**
- Pattern: `pos * esselunga*` prende la descrizione d'esempio; `.*(a+)+$` resta testo letterale, verifica **AC-2**
- Azione non valida: categoria di entrata su una spesa si salta e la regola dopo mette la sua, verifica **AC-6**
- Giroconto: spesa da conto A con `transferAccountId` B diventa giroconto A → B senza categoria, verifica **AC-4**
- Auth/permission: scrivere una regola in un'altra famiglia → 404; riferimento a una categoria di un'altra famiglia → 422, verifica **AC-15**

## Build plan

Tracer Bullet: prima il filo import → regola → movimento attraverso `core`, dati e una UI minima, poi si ispessisce.

1. [x] `core`: schema allargato (`match`, `memberIds`, `pattern`, `transferAccountId`, `recurring`), `ruleMatches`, `wildcardMatch`, `applyRules`, `ruleImportHook`, `ruleIssues`, test, satisfies **AC-1**..**AC-7**
2. [x] `core`: `planApplyRules`, `previewRule`, `suggestFromRules`, `ruleFromTransaction`, `payeeNameFromDescription`, `reorderRules`, test, satisfies **AC-9**..**AC-14**
3. [x] Dati: `RuleDoc` Pydantic + collezione `rules` nel server con controllo dei riferimenti, `gen:api`, contract suite gruppo `rules` (memory, http; firebase saltato), test pytest, satisfies **AC-15**
4. [x] UI: `/altro/regole` (lista, riordino, abilita, duplica, elimina, applica a tutti), editor `/altro/regole/:id` con anteprima dal vivo e "Applica ai movimenti esistenti", satisfies **AC-10**, **AC-11**, **AC-14**
5. [x] UI: hook nell'import, suggerimenti nel nuovo movimento, "Crea regola" dal movimento, satisfies **AC-8**, **AC-9**, **AC-12**, **AC-13**

## Consequences

**Positive**:
- Un solo motore per import, modulo, anteprima e applicazione ai vecchi: nessun comportamento diverso tra i percorsi.
- Nessuna migrazione e nessuna route nuova; il feature 13 riusa `ruleMatches` per riconoscere i ricorrenti.

**Negative / tradeoffs**:
- Le regole si applicano nel client: due membri che applicano nello stesso momento possono scrivere due volte lo stesso risultato (innocuo, è idempotente).
- Un campo messo da una regola che poi cambi non torna indietro da solo (scelta voluta: niente cancellazioni a sorpresa).
- Riferimenti sospesi in Firestore (categoria eliminata) restano nella regola; il motore li salta e la lista li segnala.

**Neutral**:
- Lo spec 0002 resta valido: `rules` si allarga in modo compatibile (campi nuovi opzionali).

## Follow-up

- [ ] Feature 13: il riconoscimento dei ricorrenti legge `ruleIds` con `actions.recurring` e riusa `ruleMatches` per `descriptionMatch`.
- [ ] Possibile in futuro: "ferma qui" su una regola, condizioni su categoria già messa, statistiche d'uso delle regole.
