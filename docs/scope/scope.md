# Scope: Noi2Contiamo

Web app open source per tenere la contabilità di coppia e di famiglia: ognuno si registra, crea o entra in una famiglia, registra o importa i movimenti, divide le spese con regole automatiche e vede dashboard di coppia e personali. Pensata per uso privato, ma pubblicata in modo che chiunque possa installarla in casa (self hosted).

**Build approach:** Tracer Bullet (prima un filo sottile ma reale che attraversa tutti i livelli, poi ogni slice lo ispessisce, sempre end to end).
**Workflow:** Beta (dopo `/develop`: `/check verify`, poi `/test` con test locali). Niente `/check review` con un altro modello e niente `/document` di default, per scelta tua. `/architect` resta il primo passo consigliato quando c'è una decisione da prendere, ma puoi saltarlo se sai già come costruire.

_Queste sono raccomandazioni per tenere la costruzione ordinata, non obblighi. Salta quello che non ti serve. Decidi tu quando una feature è `done`._

**Vincoli trasversali (valgono per ogni feature):** interfaccia in italiano; funziona bene da telefono; tema chiaro e scuro; nessun servizio a pagamento o abbonamento richiesto (niente piani tipo Blaze); deve girare in tre modi (container, piattaforma cloud con piano gratuito, server locale semplice); i test girano in locale, non pesano sulla CI.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Prototipo PHP attuale | Riferimento | existing |
| 1 | Stack & architettura | Foundation | done |
| 2 | Coding standards, tooling & test locali | Foundation | done |
| 3 | Data model | Foundation | done |
| 4 | Design system & UI foundation | Foundation | done |
| 5 | Filo base: accesso, famiglia, primo movimento | Slice 1 | done |
| 6 | Inviti ai membri della famiglia | Slice 2 | done |
| 7 | Conti, categorie e destinatari | Slice 3 | done |
| 8 | Registro movimenti con filtri e suddivisioni | Slice 4 | done |
| 9 | Divisione spese tra i membri | Slice 5 | done |
| 10 | Giroconti e saldo finale tra i membri | Slice 6 | done |
| 11 | Import CSV con profili salvati | Slice 7 | done |
| 12 | Regole automatiche | Slice 8 | done |
| 13 | Pagamenti ricorrenti e previsioni | Slice 9 | done |
| 14 | Dashboard di coppia | Slice 10 | done |
| 15 | Area personale | Slice 11 | done |
| 16 | Confronto tra periodi | Slice 12 | done |
| 17 | Export CSV | Slice 13 | done |
| 18 | Report PDF settimanali, mensili, annuali | Slice 14 | done |
| 19 | Promemoria e notifiche gratuite | Slice 15 | done |
| 20 | Pacchetti di installazione (container, cloud, locale) | Slice 16 | planned |
| 21 | Pronto per l'open source | Slice 17 | planned |
| 22 | Interfaccia in inglese | Deferred | planned |
| 23 | Backup e spostamento dati tra modalità | Deferred | planned |

## Riferimento

### A. Prototipo PHP attuale · existing
Primo prototipo: login, registro movimenti, quota 50/50, chi deve a chi, due grafici, import CSV solo finto. Serve come riferimento per funzioni e categorie; verrà sostituito dalla nuova base. Ha problemi noti (password non cifrate nei dati demo, cancellazioni senza controllo di famiglia, HTML iniettabile). code in `./index.html`, `./script.js`, `./api.php`, `./noi2contiamo.sql`

## Foundations

### 1. Stack & architettura · done
Scegliere linguaggi, framework e architettura che permettono le tre modalità di installazione (container, cloud gratuito, server locale) con un unico codice, e notifiche senza abbonamenti.
**Done when:** la scelta è registrata in uno spec, con il perché di ogni modalità di installazione, e lo scheletro vuoto parte in locale e passa la build.
spec: [0001](../specs/0001-stack-architettura/index.md)
code in `./package.json`, `./packages/core`, `./packages/data`, `./apps/web`, `./server`
- [x] Decide the stack (spec): `/architect stack & architettura`
- [x] Scaffold from the decision: `/develop stack & architettura`
- [x] Verify it: `/check verify stack & architettura` (verificato durante lo scaffold)
- [x] Test it: `/test stack & architettura` (skipped: coperto da `npm run check`)

### 2. Coding standards, tooling & test locali · done
Fissare convenzioni, lint, formattazione e una struttura di test che giri in locale quando serve (prima del commit o a comando), senza consumare minuti di CI.
**Done when:** `AGENTS.md` riflette lo stack reale; lint e format passano puliti; un solo comando lancia i test in locale; la CI, se esiste, resta leggera.
code in `./AGENTS.md`, `./eslint.config.js`, `./.prettierrc.json`, `./lint-staged.config.mjs`, `./tsconfig.tools.json`, `./server/pyproject.toml`
- [x] Capture conventions + tooling choices: `/audit`
- [x] Build it: `/develop tooling` (ESLint, Prettier, Ruff, hook di commit, `npm run check`)

### 3. Data model · done
Le entità su cui poggia tutto: utenti, famiglie, membri, conti personali e comuni, categorie, destinatari, movimenti, quote di divisione, giroconti, regole, profili di import, ricorrenze, promemoria. Gli importi devono essere esatti (niente arrotondamenti sbagliati).
**Done when:** il modello regge tutte le slice previste (divisioni in percentuale, regole, ricorrenze, import) senza migrazioni distruttive, e ogni dato è isolato per famiglia.
spec: [0002](../specs/0002-data-model/index.md)
code in `packages/core/src/model/`, `packages/core/src/split.ts`, `packages/data/src/memory.ts`, `server/src/noi2contiamo_server/models.py`, `server/alembic/versions/0002_data_model.py`, `firebase/firestore.rules` (route HTTP, adapter Firebase e test delle regole sull'emulatore passano al feature 5)
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
  - [x] Schemi zod, invarianti e `allocateShares` in `core` per le collezioni del filo (AC-1, AC-2, AC-3)
  - [x] `DataAdapter` con query tipizzate e `membership`, memory, server (migrazione 0002) e regole Firestore (AC-4, AC-5, AC-7)
  - [x] Allargamento alle altre collezioni e impronta di import (AC-1, AC-4, AC-6)
  - [x] Export e import v1 in `core` (AC-8)
- [x] Verify it: `/check verify data model` (migrazione 0002 applicata e confrontata coi modelli, contract suite su memory; regole Firestore non verificate: serve Java 21)
- [x] Test it: `/test data model`

### 4. Design system & UI foundation · done
Stile visivo, componenti base, palette per i grafici leggibile anche dai daltonici, tema chiaro e scuro, layout da telefono.
**Done when:** esiste `design.md` con colori, tipografia e componenti; le pagine base usano gli stessi componenti; i grafici hanno una palette validata.
spec: [0003](../specs/0003-design-system/index.md) · design: [design.md](../design.md)
code in `apps/web/src/ui/`, `apps/web/src/ui/charts/`, `apps/web/src/dev/UiCatalog.tsx`, `apps/web/index.html`, `eslint.config.js`
- [x] Design it (spec): `/architect design system`
- [x] Build it: `/develop design system`
  - [x] Token, tema chiaro e scuro, test su token e contrasto (AC-1, AC-2, AC-3, AC-4)
  - [x] Filo sottile: `AppShell`, `Button`, `Card`, `Amount`, pagina attuale migrata (AC-6, AC-8, AC-9)
  - [x] Campi, modali, messaggi e `DataTable` su React Aria e TanStack Table (AC-5, AC-8, AC-10)
  - [x] Grafici con `ChartFrame` su Recharts, catalogo `/dev/ui`, axe e lint accessibilità (AC-5, AC-7, AC-10)
- [x] Verify it: `/check verify design system` (verificato durante il build: `npm run check`, `npm run build`, dev server su `/dev/ui`, axe in jsdom nei due temi; contrasto reale e larghezza 360px non provati in un browser vero)
- [x] Test it: `/test design system` (token, contrasto, colori a mano, format, tema, colori dei grafici, componenti, axe sul catalogo)

## Slice 1

### 5. Filo base: accesso, famiglia, primo movimento · done
Il filo sottile ma reale: ti registri, accedi, crei una famiglia, aggiungi un movimento e lo vedi nella lista. Auth vera, database vero, interfaccia vera.
**Done when:** un nuovo utente si registra con password cifrata, crea la sua famiglia, inserisce una spesa e la vede nel registro; un utente di un'altra famiglia non vede né modifica quei dati.
spec: [0001](../specs/0001-stack-architettura/index.md), [0002](../specs/0002-data-model/index.md), [0003](../specs/0003-design-system/index.md) (nessuno spec dedicato: le decisioni stanno lì; CSRF a double submit scelto in build, vedi `server/src/noi2contiamo_server/security.py`)
code in `server/src/noi2contiamo_server/` (`api.py`, `store.py`, `schemas.py`, `security.py`), `packages/data/src/http.ts`, `packages/data/src/firebase.ts`, `packages/data/src/contract/`, `apps/web/src/features/`, `apps/web/src/routes.tsx`, `packages/core/src/model/defaults.ts`, `scripts/gen-api.mjs`, `scripts/contract-http.mjs`
- [x] Build it: `/develop filo base`
  - [x] Server: registrazione, accesso, uscita (Argon2id, sessione HttpOnly, CSRF), famiglie, documenti, commit, inviti e uscita; isolamento con 404
  - [x] Adapter HTTP con tipi da OpenAPI (`gen:api`), suite di contratto su server vero (`test:contract:http`: 22 passati, impostazioni ed export saltati)
  - [x] Adapter Firebase per il filo (non verificato: l'emulatore serve Java 21, `test:rules` e `contract/firebase.test.ts` restano saltati)
  - [x] UI: accesso, registrazione, crea famiglia (conto e categorie del prototipo), nuovo movimento, registro, esci
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `npm run local` con richieste HTTP vere e accesso da un'altra famiglia → 404, SPA servita)
- [x] Test it: pytest `server/tests/test_filo.py`, contract suite gruppo `filo`, `apps/web/src/features/flow.test.tsx` e `newTransaction.test.ts`

## Slice 2

### 6. Inviti ai membri della famiglia · done
Un membro invita l'altro (codice o link) e la famiglia diventa condivisa; gestione dei ruoli e uscita dalla famiglia.
**Done when:** il partner entra con l'invito e vede gli stessi movimenti comuni; un invito scaduto o già usato viene rifiutato; un membro può lasciare la famiglia.
spec: [0002](../specs/0002-data-model/index.md) (membri, inviti, AC-7; nessuno spec dedicato). Scelte prese in build: `membership.setMemberRole` e `removeMember` aggiunti al `DataAdapter`; chi è uscito rientra con un nuovo invito sullo stesso membro; un invito esistente si può solo revocare; famiglia attiva ricordata nel browser; in Firebase il token porta anche `role` e `memberId`.
code in `apps/web/src/features/family/` (`FamilyPage.tsx`, `JoinForm.tsx`, `JoinPage.tsx`, `invite.ts`), `packages/data/src/{memory,http,firebase,token}.ts`, `firebase/firestore.rules`, `server/src/noi2contiamo_server/{api,store}.py`, `server/tests/test_inviti.py`
- [x] Build it: `/develop inviti`
  - [x] Server, memory e HTTP: rientro dopo l'uscita, ruoli, rimozione, inviti solo revocabili (contract suite gruppo `invites`)
  - [x] Adapter Firebase e regole per inviti, uscita, ruoli (non verificato: l'emulatore serve Java 21, gruppo saltato)
  - [x] UI: link `/invito/:codice`, codice in `/benvenuto`, pagina `/altro/famiglia` (membri, ruoli, persone senza account, inviti, cambio famiglia, uscita)
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 31 passati, `npm run local` con richieste HTTP vere: invito, ingresso del partner che vede i movimenti comuni, invito usato e scaduto rifiutati, uscita, ultimo proprietario bloccato)
- [x] Test it: contract suite gruppo `invites`, `server/tests/test_inviti.py`, `apps/web/src/features/family/{family,invite}.test.ts(x)`

## Slice 3

### 7. Conti, categorie e destinatari · done
Gestione di conti personali e comuni (con saldo iniziale), categorie di entrata e uscita, e destinatari dei pagamenti (negozi, fornitori, persone).
**Done when:** puoi creare, rinominare e archiviare conti, categorie e destinatari; ogni movimento può riferirsi a uno di ciascuno; il saldo di ogni conto è corretto.
spec: [0002](../specs/0002-data-model/index.md) (accounts, categories, payees, saldo in `core`; nessuno spec dedicato). Scelte prese in build: un rimborso inverte il segno sul conto; chi possiede un conto non si cambia da qui se il conto ha già movimenti (la riscrittura dei movimenti resta da fare); colori delle categorie = slot `series-1..8`; un destinatario scritto nel movimento si crea nello stesso `commit`.
code in `packages/core/src/model/catalog.ts`, `apps/web/src/features/catalog/`, `apps/web/src/features/transactions/`, `packages/data/src/{memory,firebase}.ts`, `server/src/noi2contiamo_server/{store,schemas}.py`, `server/tests/test_catalogo.py`
- [x] Build it: `/develop conti categorie destinatari`
  - [x] `core`: `accountBalance`, `nameTaken`, `checkCategory`, `payeeFromName`, `pickable`; destinatario controllato in `checkTransaction`
  - [x] Server (collezione `payees`), memory e Firebase (non verificato) con nomi unici, un livello di categorie, destinatari usati non cancellabili
  - [x] UI: `/altro/conti` (saldo), `/altro/categorie` (sottocategorie, colore, divisione predefinita), `/altro/destinatari`, destinatario e categorie nel nuovo movimento
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http`, `npm run local`: saldo del conto 2487,50 € come atteso)
- [x] Test it: contract suite gruppo `catalog`, `packages/core/src/model/catalog.test.ts`, `server/tests/test_catalogo.py`, `apps/web/src/features/catalog/catalog.test.tsx`

## Slice 4

### 8. Registro movimenti con filtri e suddivisioni · done
Il registro completo: entrate, uscite, modifica, cancellazione, ricerca e filtri per periodo, tipo, conto, persona, categoria, destinatario, con tabelle riassuntive per ognuna di queste dimensioni.
**Done when:** ogni filtro restringe la lista e i totali; le tabelle riassuntive per tipo, conto, persona, categoria e destinatario tornano con il totale generale; lista vuota e errori hanno il loro stato.
spec: [0002](../specs/0002-data-model/index.md) (strategia letture: periodo al backend con intervallo di date e cursore, altri filtri in `core`), [design.md](../design.md) (scorciatoie del periodo, 50 righe per pagina, righe a due livelli sotto 48rem); nessuno spec dedicato. Scelte prese in build: periodo predefinito "questo mese" (più "anno scorso" e "tutto"); "persona" = chi ha pagato (`payerMemberId`, vuoto = cassa comune); il filtro conto vale anche per l'arrivo di un giroconto, ma le tabelle mettono ogni movimento in una sola riga (conto di origine) così tornano col totale; una categoria principale comprende le sue sottocategorie; i giroconti contano nei movimenti ma valgono zero e si possono solo eliminare (la modifica arriva col feature 10); modificando un movimento la divisione manuale resta, le altre seguono la nuova categoria; si elimina dopo una conferma; filtri e pagina nell'URL in italiano (`?periodo=mese-scorso&tipo=spese&q=coop&pagina=2`).
code in `packages/core/src/register.ts`, `apps/web/src/features/transactions/` (`TransactionsPage.tsx`, `NewTransactionPage.tsx` con `EditTransactionPage`, `registerUrl.ts`, `useDeleteTransaction.ts`, `newTransaction.ts`), `apps/web/src/data/queries.ts` (`useTransactionsInRange`), `apps/web/src/ui/DataTable/` (`hideOnMobile`), `packages/data/src/contract/suite.ts` (gruppo `register`)
- [x] Build it: `/develop registro movimenti`
  - [x] `core`: periodi, filtri, totali e tabelle riassuntive pure (`signedCents`, `periodRange`, `filterTransactions`, `totalsOf`, `summarize`, `pageOf`)
  - [x] Dati: periodo letto con intervallo di date e cursore su tutti e due i backend (nessuna modifica al server; adapter Firebase già pronto, non verificato: serve Java 21)
  - [x] UI: filtri nell'URL con chip, totali, registro paginato a 50 righe, modifica `/movimenti/:id`, eliminazione con conferma, tabelle per tipo, conto, persona, categoria, destinatario; stati vuoto, caricamento ed errore
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 33 passati, `npm run local` con richieste HTTP vere: periodo con cursore, modifica che sposta il movimento di mese, categoria sbagliata rifiutata con 422, cancellazione e 404, SPA servita su `/movimenti?…` e `/movimenti/:id`)
- [x] Test it: `packages/core/src/register.test.ts`, contract suite gruppo `register`, `apps/web/src/features/transactions/{register.test.tsx,registerUrl.test.ts,newTransaction.test.ts}`

## Slice 5

### 9. Divisione spese tra i membri · done
Ogni spesa può essere divisa tra i membri: in automatico secondo l'impostazione della categoria (es. affitto 60/40) oppure a mano sul singolo movimento, in percentuale o importo.
**Done when:** una spesa senza indicazioni usa la divisione della sua categoria; una divisione manuale la sovrascrive; le quote sommano sempre al 100% e al centesimo.
spec: [0004](../specs/0004-divisione-spese/index.md)
code in `packages/core/src/{split,division}.ts`, `apps/web/src/features/split/`, `apps/web/src/features/transactions/{newTransaction.ts,NewTransactionPage.tsx,TransactionsPage.tsx}`, `apps/web/src/features/catalog/CategoriesPage.tsx`, `apps/web/src/features/family/FamilyPage.tsx`, `packages/data/src/{index,memory,http,firebase}.ts`, `server/src/noi2contiamo_server/api.py` (`PUT /families/{id}/default-split`), `firebase/firestore.rules`
- [x] Design it (spec): `/architect divisione spese`
- [x] Build it: `/develop divisione spese`
  - [x] `core`: precedenza (privato > manuale > regola > categoria e principale > proprietario per le entrate > famiglia), `checkSplit`, cambio di modalità, `reapplySplits` (AC-1, AC-2, AC-3, AC-5, AC-6)
  - [x] Dati: `membership.setDefaultSplit` su memory, http (route server) e firebase (adapter e regola, non verificato: serve Java 21), contract suite gruppo `split` (AC-7)
  - [x] UI: editor nel movimento (percentuale o importo, 50/50, "Tutto a ..."), divisione della famiglia in `/altro/famiglia`, divisione delle categorie anche per le entrate, "Riapplica ai movimenti", colonna "Divisione" nel registro (AC-4, AC-6, AC-7, AC-8, AC-9)
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 36 passati, `npm run local` con richieste HTTP vere: sottocategoria che eredita 60/40 → 60,01/40,00 €, famiglia 50/50 → 50,01/50,00 €, entrata su conto di Bruno → 100% Bruno, manuale in centesimi salvata, centesimi sbagliati e chiave non membro rifiutati con `invalid`)
- [x] Test it: `packages/core/src/division.test.ts`, `apps/web/src/features/split/split.test.tsx`, `apps/web/src/features/transactions/newTransaction.test.ts`, contract suite gruppo `split`, `server/tests/test_divisione.py`

## Slice 6

### 10. Giroconti e saldo finale tra i membri · done
I giroconti tra conti della famiglia (anche tra persone diverse) vengono riconosciuti e non contano come spese; un saldo finale dice chi deve quanto a chi e permette di registrare il pareggio.
**Done when:** un giroconto non altera entrate e uscite; il saldo tra i membri tiene conto di divisioni e rimborsi; registrare un pareggio porta il saldo a zero.
spec: [0005](../specs/0005-giroconti-saldo/index.md). Scelte: la cassa comune vale per i membri secondo la divisione della famiglia; un giroconto tra membri diversi conta nel saldo anche senza `settlement`; i privati non contano; il pareggio è un giroconto con `settlement` e importo modificabile.
code in `packages/core/src/{balance,transfers}.ts`, `apps/web/src/features/balance/`, `apps/web/src/features/transactions/{newTransaction.ts,NewTransactionPage.tsx,TransactionsPage.tsx}`, `apps/web/src/routes.tsx` (`/saldo`), `apps/web/src/features/more/pages.tsx`, `packages/data/src/contract/suite.ts` (gruppo `balance`); nessuna modifica al server né alle regole Firestore
- [x] Design it (spec): `/architect giroconti e saldo`
- [x] Build it: `/develop giroconti e saldo`
  - [x] `core`: `memberBalances` (cassa comune, entrate, rimborsi, giroconti tra membri, saldo a una data e per periodo), `settlementPlan` (minimo esatto fino a 12 membri), `settlementTransfer`, `findTransferPairs`, `mergeTransferPair` (AC-3..AC-9)
  - [x] Dati: contract suite gruppo `balance` su memory e http; firebase con lo stesso codice (non verificato: serve Java 21)
  - [x] UI: `/saldo` con "Chi deve a chi", dettaglio, "Saldo al" e "Dal", "Registra pareggio", "Giroconti da riconoscere"; tipo "Giroconto" nel modulo nuovo e in modifica (AC-1, AC-10)
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 38 passati, `npm run local` con richieste HTTP vere: il giroconto lascia i totali invariati, saldo Anna +540,00 € e Bruno −540,00 € con cassa comune 50/50 e spesa 60/40, il pareggio di Bruno porta il saldo a zero, SPA servita su `/saldo`)
- [x] Test it: `packages/core/src/balance.test.ts`, `apps/web/src/features/balance/balance.test.tsx`, `apps/web/src/features/transactions/newTransaction.test.ts`, contract suite gruppo `balance`

## Slice 7

### 11. Import CSV con profili salvati · done
Import degli estratti movimenti di banche e servizi (CSV con formati diversi). Mappi le colonne una volta e salvi il profilo, così il prossimo import dalla stessa banca è immediato. Anteprima prima di confermare e niente duplicati.
**Done when:** importi un CSV di una banca, salvi il profilo, e il secondo file della stessa banca si importa senza rimappare; date, importi con virgola e segni diversi vengono letti bene; i movimenti già presenti non vengono duplicati.
spec: [0006](../specs/0006-import-csv/index.md). Scelte: il CSV si legge nel browser con `core` e non lascia il dispositivo; lotto scritto prima dei movimenti; un giroconto unito resta sul movimento esistente (stesso id) e non sparisce annullando il lotto nuovo; aggancio `hook` per le regole del feature 12.
code in `packages/core/src/import/` (con le fixture `fixtures/*.csv`), `apps/web/src/features/import/`, `apps/web/src/routes.tsx` (`/importa`), `server/src/noi2contiamo_server/{schemas,store}.py`, `packages/data/src/{memory,firebase}.ts`, `firebase/firestore.indexes.json`, `packages/data/src/contract/suite.ts` (gruppo `import`)
- [x] Design it (spec): `/architect import csv`
- [x] Build it: `/develop import csv`
  - [x] `core`: decodifica (UTF-8, BOM, Windows-1252), CSV, date, importi, intestazione, proposta delle colonne, profili con firma (AC-1..AC-8)
  - [x] `core`: `planImport` (doppioni, lotto, destinatari, divisione, giroconti, hook) e `undoImportOps` (AC-9..AC-14)
  - [x] Dati: server (profili e lotti, riferimenti 422, `in_use`), memory, firebase (impronte e `in_use`, non verificato: serve Java 21), contract suite gruppo `import` (AC-15)
  - [x] UI: `/importa` con File, Colonne, Anteprima, Conferma, Risultato, "Salva profilo", storico con "Annulla import" (AC-16)
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 39 passati, `npm run local` con richieste HTTP vere: primo import 8 nuovi e 2 errori con profilo salvato, secondo import profilo riconosciuto e 0 nuovi su 8 doppioni, lotto con movimenti rifiutato con `in_use`, annullamento a zero movimenti, reimport di nuovo 8 nuovi, SPA servita su `/importa`)
- [x] Test it: `packages/core/src/import/import.test.ts` (4 fixture), `apps/web/src/features/import/import.test.tsx` (procedura e axe), contract suite gruppo `import`, `server/tests/test_import.py`

## Slice 8

### 12. Regole automatiche · done
Regole che assegnano categoria, destinatario e divisione tra i membri (con percentuale) in base a tipo, conto, destinatario o testo della descrizione. Valgono sia all'import sia all'inserimento manuale.
**Done when:** una regola creata si applica ai nuovi movimenti e, a richiesta, a quelli vecchi; l'ordine delle regole decide chi vince; puoi creare una regola partendo da un movimento.
spec: [0007](../specs/0007-regole-automatiche/index.md). Scelte: per ogni campo vince la prima regola in ordine, condizioni sui valori originali, `pattern` con `*` e `?` senza regex, manuale mai sovrascritto (destinatario `import` sì), candidato ricorrente derivato da `ruleIds`, nessuna migrazione.
code in `packages/core/src/rules/`, `apps/web/src/features/rules/`, `apps/web/src/features/transactions/{newTransaction.ts,NewTransactionPage.tsx}`, `apps/web/src/features/import/ImportPage.tsx`, `apps/web/src/routes.tsx` (`/altro/regole`), `server/src/noi2contiamo_server/{schemas,store}.py`, `packages/data/src/contract/suite.ts` (gruppo `rules`)
- [x] Design it (spec): `/architect regole automatiche`
- [x] Build it: `/develop regole automatiche`
  - [x] `core`: motore (condizioni, `pattern` sicuro, `all`/`any`, azioni, prima vince per campo, manuale intoccabile), hook di import (AC-1..AC-8)
  - [x] `core`: applica ai vecchi, anteprima, suggerimenti, crea da movimento, destinatario dalla descrizione, riordino (AC-9..AC-14)
  - [x] Dati: `RuleDoc` nel server con riferimenti 422, contract suite gruppo `rules` (AC-15; firebase con lo stesso codice, non verificato: serve Java 21)
  - [x] UI: `/altro/regole` con riordino ed editor con anteprima, regole nell'import e nel nuovo movimento, "Crea regola" (AC-8..AC-14)
- [x] Verify it: verificato durante il build (`npm run check`, `npm run build`, `test:contract:http` 40 passati, `npm run local` con richieste HTTP vere: import della fixture Revolut con le regole → Esselunga categoria e destinatario `rule`, "To Bruno Bianchi" giroconto, Amazon con `recurring`; riferimento inesistente 422; "Applica ai vecchi" salta la categoria corretta a mano e una seconda applicazione dà zero cambi; SPA servita su `/altro/regole`)
- [x] Test it: `packages/core/src/rules/rules.test.ts`, `apps/web/src/features/rules/rules.test.tsx` (lista, riordino, applica, crea da movimento, anteprima, suggerimento, axe), contract suite gruppo `rules`, `server/tests/test_regole.py`

## Slice 9

### 13. Pagamenti ricorrenti e previsioni · done
Inserimento di pagamenti ricorrenti (affitto, abbonamenti, bollette), riconoscimento automatico di quelli già presenti nello storico, e previsione dei costi futuri.
**Done when:** una ricorrenza genera le scadenze previste; il sistema propone come ricorrenti i pagamenti simili che si ripetono; la previsione mostra il saldo atteso nei prossimi mesi; un pagamento reale chiude la scadenza prevista.
- [ ] Design it (spec): `/architect ricorrenze e previsioni`

## Slice 10

### 14. Dashboard di coppia · done
Vista d'insieme della famiglia: indicatori principali, andamento entrate e uscite, spese per categoria, contributo di ciascun membro, saldo tra i membri. Grafici dinamici con tabelle riassuntive.
**Done when:** la dashboard si aggiorna al cambio del periodo; ogni grafico ha la sua tabella; i totali coincidono con il registro.
Scelte: aggregati puri in `packages/core/src/dashboard.ts`; la home `/` è la dashboard (selettore settimana/mese/anno con precedente/successivo, interruttore famiglia/personale, grafici lazy con tabella). Giroconti fuori da entrate e uscite; rimborsi sottratti. Vista famiglia: solo movimenti condivisi (i privati mai, nemmeno i propri). "Chi ha pagato" = spese per `payerMemberId` (null = cassa comune), colori per ordine di ingresso. Andamento a settimane (mese/settimana) o mesi (anno). Il saldo tra i membri riusa `memberBalances` sul periodo. Nessuna modifica ai backend.
- [x] Build it

## Slice 11

### 15. Area personale · done
Le stesse viste ma solo tue: le tue spese, la tua quota delle spese comuni, i tuoi conti e il loro saldo.
**Done when:** passando da vista di coppia a vista personale i numeri cambiano in modo coerente; i conti personali dell'altro membro restano privati se lui lo decide.
Scelte: `/personale` è la stessa pagina con vista personale. Conta la quota (`split`) del membro sui movimenti condivisi; senza `split` l'intero importo solo se conto o movimento sono suoi; i movimenti privati solo se `ownerMemberId` è l'utente, quelli di un altro membro non entrano mai (controllo anche in `core`).
- [x] Build it: `/develop area personale`

## Slice 12

### 16. Confronto tra periodi · done
Confronto tra settimane, mesi o anni (questo mese contro il precedente, contro lo stesso mese dell'anno prima) su totali e categorie.
**Done when:** scegli due periodi e vedi la differenza in valore e percentuale per totale e per categoria; funziona in vista di coppia e personale.
Scelte: periodi a calendario (settimana lun-dom, mese, anno); confronto con il precedente o con lo stesso periodo dell'anno prima (settimana: 52 settimane prima; per l'anno solo il precedente). Differenza in centesimi e percentuale in punti base; con base zero la percentuale è `null` e la UI scrive "n.d. (base zero)". Categorie presenti in un solo periodo incluse, ordinate per variazione assoluta. Vale in entrambe le viste.
- [x] Build it: `/develop confronto periodi`

## Slice 13

### 17. Export CSV · done
Esporta i movimenti filtrati e le tabelle riassuntive in CSV, leggibile da Excel italiano.
**Done when:** il file esportato rispetta i filtri attivi, si apre correttamente in un foglio di calcolo con accenti e importi giusti.
Scelte: serializzazione pura in `packages/core/src/csv.ts`; separatore `;`, BOM UTF-8, virgola decimale senza migliaia, date gg/mm/aaaa, righe CRLF. I testi che iniziano con `= + - @` ricevono un apice davanti (formula injection). Importi con segno (spese negative), giroconti positivi. Si esportano tutti i movimenti filtrati, non solo la pagina; ogni tabella riassuntiva ha il suo pulsante.
- [x] Build it

## Slice 14

### 18. Report PDF settimanali, mensili, annuali · done
Report PDF del periodo scelto con riepilogo, grafici, divisioni tra i membri e saldo finale.
**Done when:** scarichi il PDF di una settimana, un mese o un anno; i numeri coincidono con la dashboard; il PDF è leggibile anche stampato in bianco e nero.
Scelte: dati puri in `packages/core/src/report.ts` (riusa dashboard e `memberBalances`, quindi numeri identici); nessuna spec, tutto nel browser e uguale nei due backend. jsPDF 4.2.1 solo in `apps/web`, import dinamico al clic (fuori dal bundle principale). Grafici disegnati a mano con tratteggi diversi ed etichette dirette con valore, leggibili in bianco e nero. Il selettore del periodo è quello della dashboard (settimana/mese/anno) con il pulsante di download accanto; il report segue la vista famiglia/personale. Saldo finale solo in vista famiglia; i movimenti privati non entrano mai.
- [x] Build it

## Slice 15

### 19. Promemoria e notifiche gratuite · done
Promemoria per scadenze ricorrenti, saldo da pareggiare e import da fare, usando solo canali gratuiti e senza piani a pagamento.
**Done when:** ricevi un promemoria prima di una scadenza; puoi attivare o spegnere ogni tipo di promemoria; funziona in tutte e tre le modalità di installazione (o il limite è dichiarato chiaramente).
Scelte: il browser calcola (`packages/core/src/reminders.ts`, id stabili dalla chiave `tipo|rif|data`), elenco con numero accanto ad Altro e notifiche del browser solo ad app aperta, dopo un clic. Solo Python: il browser carica i promemoria nuovi (quindi solo quando qualcuno apre l'app) e un ciclo in-process invia email SMTP e Telegram, con variabili `N2C_*` facoltative, nessun doppio invio e tentativi limitati. Niente Web Push (serve HTTPS, di solito assente su un server di casa); con Firebase Spark restano solo elenco e notifiche del browser, dichiarato nelle impostazioni. Nessuna spec dedicata.
- [x] Build it

## Slice 16

### 20. Pacchetti di installazione (container, cloud, locale)
Rendere reali le tre modalità decise nello spec dello stack: container pronto, deploy sul cloud con piano gratuito, avvio locale con un comando.
**Done when:** seguendo la guida, una persona nuova avvia l'app in ognuna delle tre modalità senza modifiche al codice; i dati demo si caricano con un comando.
- [ ] Build it: `/develop pacchetti installazione`

## Slice 17

### 21. Pronto per l'open source · needs decision
Licenza, README con guida all'installazione, file di esempio per la configurazione, nessun segreto nel repository, dati demo.
**Done when:** il repository è pubblicabile senza credenziali dentro; il README porta dall'installazione al primo movimento; la licenza è scelta e presente.
- [ ] Design it (spec): `/architect open source`

## Deferred

### 22. Interfaccia in inglese
Traduzione dell'interfaccia per chi installa l'app fuori dall'Italia. Utile per l'open source, non necessaria per voi.
**Done when:** l'utente sceglie la lingua e tutta l'interfaccia, i report e gli export la seguono.
- [ ] Design it (spec): `/architect lingue`

### 23. Backup e spostamento dati tra modalità · from spec 0001
Export completo dei dati da un backend e import nell'altro (Firebase verso server locale e viceversa), più backup del file SQLite.
**Done when:** esporti tutti i dati di una famiglia da una modalità e li reimporti nell'altra senza perdite; il backup del server locale si ripristina con un comando.
- [ ] Design it (spec): `/architect backup e migrazione dati`

## Legenda

- **Next step** = la prima casella non spuntata.
- **needs decision** = conviene `/architect` prima; altrimenti direttamente `/develop`.
- **Status**: `planned` → `in-progress` → `done`, più `existing` (prima del workflow) e `dropped` (tolta, tenuta per storia).
- I task di dettaglio vivono nel `## Build plan` dello spec, non qui.
