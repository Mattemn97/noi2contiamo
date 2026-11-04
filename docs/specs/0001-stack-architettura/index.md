# 0001. Stack e architettura: logica in TypeScript condivisa, due backend sottili

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Tutta la logica dell'app (divisioni, regole, ricorrenze, import CSV, saldi, totali, export) vive in un solo pacchetto TypeScript che gira nel browser. Il frontend React parla con i dati attraverso una sola interfaccia (un "adapter", cioè un traduttore) che ha due versioni: una per Firebase sul piano gratuito Spark, una per un server Python FastAPI che puoi far girare in casa, anche in Docker. I due backend fanno solo da magazzino con login e isolamento per famiglia, così non scrivi mai la stessa regola due volte. Gli importi sono sempre numeri interi in centesimi.

## Requirements

**User stories**:
- Come persona che installa l'app in casa, voglio avviarla con un comando (o con `docker compose up`) così da non dover configurare niente a mano.
- Come coppia che non vuole gestire un server, voglio pubblicare l'app su un mio progetto Firebase gratuito così da raggiungerla sempre da telefono.
- Come sviluppatore, voglio scrivere ogni regola di dominio una volta sola e testarla in locale con un comando.

**Acceptance criteria** (li verifica lo scaffold, cioè lo scheletro vuoto, del feature 1):
- **AC-1**: `npm install` alla radice installa tutti i workspace; `npm run build` compila `packages/core`, `packages/data` e `apps/web` senza errori di tipo.
- **AC-2**: lo stesso codice di `apps/web` produce due build diverse scegliendo solo `VITE_BACKEND=firebase` oppure `VITE_BACKEND=http`; la build `http` non contiene il codice dell'SDK Firebase.
- **AC-3**: `npm run local` costruisce il frontend e avvia il server Python, che serve la pagina su `http://localhost:8000` e risponde `200` su `GET /api/health`; al primo avvio crea il database SQLite e applica le migrazioni Alembic da solo.
- **AC-4**: `docker compose up` avvia la stessa app su `http://localhost:8000` con i dati salvati in un volume che sopravvive al riavvio del container.
- **AC-5**: `npm run deploy:firebase` (con un progetto configurato) pubblica Hosting, regole e indici Firestore senza richiedere Cloud Functions, Cloud Storage o il piano Blaze.
- **AC-6**: `npm test` alla radice lancia Vitest su tutti i pacchetti TypeScript e pytest sul server, ed esce con codice diverso da zero se un test fallisce; `npm run test:rules` (opzionale) lancia i test delle regole Firestore sull'emulatore.
- **AC-7**: `packages/core` non importa React, Firebase, `fetch` né API del browser legate all'IO (verificato da una regola di lint o da un test sugli import).
- **AC-8**: l'app avviata in entrambe le modalità mostra una pagina in italiano, installabile come PWA, con tema chiaro e scuro che segue il sistema.

## Decision

**Chosen option**: Option 1: monorepo npm, dominio TypeScript condiviso nel browser, due adapter (Firebase Spark e HTTP verso FastAPI).

Un solo frontend React + TypeScript (Vite, PWA) usa `packages/core` per tutta la logica e `packages/data` per i dati, con l'adapter scelto al momento della build; Firebase (Auth + Firestore + regole) e un server Python sottile (FastAPI + SQLAlchemy + Alembic) sono due magazzini intercambiabili.

**Implementation skills**: nessuna skill della community installata per questo stack (vedi Follow-up).

## Rationale

Ragionamento, contesto e opzioni scartate: vedi [rationale.md](rationale.md).

## Proposed stack

Versioni verificate sul registro npm e PyPI il 2026-11-03. Fissa la minor (la versione intermedia, ad esempio `^19.3`) nel `package.json` e nel `pyproject.toml`; i lockfile (`package-lock.json`, `uv.lock`) fissano il resto.

### Struttura del repository

```
noi2contiamo/
  package.json            # workspaces: apps/*, packages/*; script radice
  tsconfig.base.json
  firebase.json  .firebaserc.example
  firebase/firestore.rules  firebase/firestore.indexes.json  firebase/tests/
  apps/web/               # @noi2contiamo/web: React, Vite, PWA
  packages/core/          # @noi2contiamo/core: dominio puro, zero IO
  packages/data/          # @noi2contiamo/data: interfaccia DataAdapter + adapter memory, firebase, http
  server/                 # Python: pyproject.toml, uv.lock, src/noi2contiamo_server/, alembic/, tests/
  Dockerfile  compose.yaml  .env.example
  index.html script.js api.php ...   # prototipo PHP, solo riferimento, resta dov'è
```

I pacchetti interni sono "internal packages": esportano direttamente i sorgenti `.ts` (campo `exports` verso `src/index.ts`), li compilano Vite e Vitest; `tsc -b` con project references fa solo il controllo dei tipi. Nessuna build separata per `core` e `data`.

### Livelli

| Layer | Choice | Reason |
|---|---|---|
| Pattern | Monolite modulare: dominio in `packages/core`, accesso dati dietro `DataAdapter`, backend sottili | Un solo posto per ogni regola, e il Spark plan non permette logica sul server comunque. |
| Monorepo | npm workspaces (npm 11, Node 24 LTS, `engines.node >=22`) | Già installato, basta per 3 pacchetti; pnpm non porta un vantaggio decisivo qui (runner up). |
| Linguaggio frontend | TypeScript `6.0.x` in modalità `strict` | TypeScript 7 (il compilatore nativo) è uscito, ma `typescript-eslint 8.72` supporta solo `<6.1`; si passa a 7 quando il lint lo supporta. |
| UI | React `19.3` | Scelta dell'utente; ecosistema più grande. |
| Build | Vite `8.3` + `@vitejs/plugin-react 6.2` | Standard per una SPA React, veloce, nessun server di rendering necessario. |
| PWA | `vite-plugin-pwa 2.0` (Workbox) | Manifest e service worker generati, supporta Vite 8, base per i promemoria nel browser. |
| Routing | `react-router 8.5` in modalità SPA (data router, senza framework mode) | Boring e stabile; niente SSR perché Firebase Hosting serve solo file statici (runner up: TanStack Router). |
| Stato dei dati remoti | `@tanstack/react-query 5.105` sopra `DataAdapter` | Cache, ricarica e stati di caricamento/errore uguali per entrambi i backend. |
| Validazione | `zod 4.6` in `packages/core` | Schemi di input, profili CSV e regole validati una volta, nel browser. |
| Date | `date-fns 4.4` + `Intl` con locale `it-IT` | Funzioni pure, adatte a `core`; `Temporal` non è ancora affidabile ovunque. |
| ID | UUIDv7 generati dal client (`uuid 14`, funzione `v7`) | Stesso ID in Firestore e SQL, ordinabile nel tempo, permette scritture offline su Firestore. |
| Denaro | Interi in centesimi (`type Cents = number & {brand}`), percentuali in punti base (10000 = 100%) | Nessun errore di virgola mobile; gli interi restano esatti fino a 2^53. |
| Stile e componenti | Deciso nel feature 4 (design system) | Fuori da questo spec; vincolo: deve funzionare senza server (CSS statico). |
| Grafici, CSV, PDF | Librerie scelte nei rispettivi spec (14, 11, 17, 18) | Vincolo da qui: solo librerie JavaScript che girano nel browser, niente generazione sul server. |
| Backend modalità 1 | Firebase piano Spark: Hosting + Authentication (email e password) + Cloud Firestore + Security Rules; SDK `firebase 13.2` modulare | Gratuito, sempre online; niente Functions né Cloud Storage (entrambi richiedono Blaze). |
| Backend modalità 2 | Python `>=3.12`, FastAPI `0.162`, Uvicorn `0.54`, Pydantic `2.14`, pydantic-settings `2.16` | FastAPI genera OpenAPI da cui nascono i tipi TypeScript dell'adapter HTTP. |
| ORM e migrazioni | SQLAlchemy `2.1` (sincrono) + Alembic `1.20` | Sincrono è più semplice e basta per una famiglia; FastAPI esegue gli endpoint sincroni in un thread pool. |
| Database modalità 2 | SQLite di default (file in `data/`, WAL attivo); PostgreSQL opzionale con `psycopg 3.3` tramite `N2C_DATABASE_URL` | Zero configurazione in casa; Postgres per chi lo ha già. |
| Auth modalità 2 | Email e password con `pwdlib 0.3` (Argon2id); sessione opaca in tabella `sessions` (token casuale, salvato come hash), cookie `HttpOnly`, `Secure` fuori da localhost, `SameSite=Lax` | Sessioni revocabili e niente JWT da gestire; stessa origine perché il server serve il frontend. |
| Contratto HTTP | REST JSON sotto `/api/v1`; tipi generati con `openapi-typescript 7.13`, client `openapi-fetch 0.17` | Il server resta la fonte dello schema HTTP, il TypeScript non va riscritto a mano. |
| Gestione Python | `uv 0.13` (`uv sync`, `uv run`, `uv.lock`) | Un comando installa Python e dipendenze; runner up: `pip` + `venv`. |
| Container | Dockerfile multi stage (`node:24` per la build web, `python:3.13-slim` per il runtime), `compose.yaml` con volume `n2c-data` e profilo opzionale `postgres` | Un'immagine sola con frontend già compilato. |
| Test | Vitest `5.1` (progetti per workspace) + `@testing-library/react 16.3`; pytest `9.2` + `httpx 0.28` (TestClient); `@firebase/rules-unit-testing 6.0` + emulatore (opzionale, richiede Java) | Tutto in locale, un comando; la CI non è richiesta. |
| Lint e format | Default proposti, da confermare nel feature 2: ESLint `10` + `typescript-eslint 8.72` + Prettier `3.9`; Ruff `0.17` per Python | Il feature 2 li fissa con `/audit`; qui serve solo che esistano versioni compatibili. |
| Deploy Firebase | `firebase-tools 15.34` come devDependency | Nessuna installazione globale richiesta. |
| Script di sviluppo | `concurrently 10` per `npm run dev:local` (Vite + Uvicorn insieme, proxy `/api` verso `:8000`) | Funziona uguale su Windows, macOS e Linux. |
| Osservabilità | Log strutturati con `logging` della libreria standard nel server, endpoint `GET /api/health`, error boundary React; nessun servizio esterno | Uso privato, nessun servizio a pagamento. |

### Contratto DataAdapter (il confine tra dominio e dati)

- `packages/data` esporta `interface DataAdapter` con: `auth` (registrati, accedi, esci, utente corrente, ascolta cambi di sessione), operazioni per collezione con scope di famiglia (`list(familyId, collection, query)`, `get`, `put`, `remove`), e `commit(familyId, ops[])` atomico per operazioni su più documenti (import, pareggio, applicazione regole). Le collezioni concrete e le query ammesse le fissa lo spec del data model (feature 3).
- Le API sono a Promise; nessuna sottoscrizione realtime obbligatoria. React Query ricarica al focus e dopo ogni scrittura.
- Implementazioni: `memory` (test e demo), `firebase` (import `@noi2contiamo/data/firebase`), `http` (import `@noi2contiamo/data/http`). `apps/web` carica quella giusta con un `import()` dinamico in base a `import.meta.env.VITE_BACKEND`, così l'altra non finisce nel bundle.
- Una suite di contract test in `packages/data/src/contract/` gira sempre su `memory`; su `http` contro un server FastAPI di test (`npm run test:contract:http`) e su `firebase` contro l'emulatore (`npm run test:rules`) quando li lanci.
- `commit` con più di 500 operazioni viene spezzato in blocchi (limite dei batch Firestore); l'adapter HTTP manda un blocco per transazione SQL.

### Responsabilità dei backend

| Compito | Firebase Spark | Server Python |
|---|---|---|
| Login | Firebase Authentication | Tabelle `users` e `sessions`, Argon2id |
| Isolamento per famiglia | Dati sotto `families/{familyId}/...`; le regole consentono accesso solo se esiste `families/{familyId}/members/{uid}` | Ogni tabella ha `family_id`; ogni route ricava la famiglia dalla sessione e verifica l'appartenenza in una dipendenza FastAPI comune |
| Integrità di base | Regole: tipi dei campi, importi interi, `createdBy == request.auth.uid`, campi ammessi | Modelli Pydantic, vincoli SQL (FK, unique, check), importi `INTEGER`/`BIGINT` |
| Logica di dominio | Nessuna (nel browser) | Nessuna (nel browser) |
| Offline | Cache persistente di Firestore (`persistentLocalCache`, multi tab): legge e scrive offline | Solo la shell PWA in cache; scrivere richiede rete |
| Promemoria | Nel browser all'apertura e via service worker | Il browser calcola e salva promemoria con data; il server li invia all'ora giusta (Web Push VAPID, SMTP, Telegram) con un ciclo periodico avviato nel lifespan di FastAPI. Dettagli nel feature 19 |

### Configurazione richiesta

- `VITE_BACKEND`: `firebase` oppure `http` (default `http`).
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`: configurazione pubblica del progetto Firebase (non sono segreti, la sicurezza sta nelle regole).
- `VITE_USE_FIREBASE_EMULATOR`: `true` per usare l'emulatore in sviluppo.
- `N2C_DATABASE_URL`: default `sqlite:///./data/noi2contiamo.db`.
- `N2C_SECRET_KEY`: segreto del server (obbligatorio fuori da sviluppo; il server si rifiuta di partire senza).
- `N2C_STATIC_DIR`: cartella del frontend compilato (default `apps/web/dist`, nel container `/app/static`).
- `N2C_HOST`, `N2C_PORT`: default `127.0.0.1` e `8000` (nel container `0.0.0.0`).
- `N2C_COOKIE_SECURE`: default `auto` (sicuro tranne su localhost).
- Le variabili per SMTP, Telegram e VAPID le definisce lo spec delle notifiche.

### Script alla radice

`dev:local`, `dev:firebase`, `build`, `build:firebase`, `local` (build + avvio server), `typecheck`, `lint`, `test` (= `test:ts` + `test:py`), `test:rules`, `test:contract:http`, `gen:api` (rigenera i tipi da OpenAPI), `deploy:firebase`.

### Invarianti

- `packages/core` è puro: niente IO, niente React, niente SDK. Ogni calcolo di dominio passa da lì, anche nei test.
- Denaro sempre in centesimi interi; nessun `number` con decimali per gli importi in nessun livello (TS, JSON, SQL, Firestore).
- Nessun dato di una famiglia è leggibile o scrivibile da un utente che non ne è membro, in entrambe le modalità.
- I due backend devono passare la stessa suite di contract test.
- Nessuna dipendenza da servizi a pagamento o dal piano Blaze.

## Consequences

**Positive**:
- Ogni regola si scrive e si testa una volta, in TypeScript, con test veloci senza database.
- Passare da Firebase a server locale cambia solo una variabile di build.
- Firebase Spark funziona davvero gratis: nessuna funzione sul server da pagare.
- Il server Python resta piccolo e facile da leggere.

**Negative / tradeoffs**:
- Il server si fida del client per la logica di dominio: una divisione calcolata male da un client modificato viene salvata se rispetta i vincoli di base. Accettabile per un uso privato di famiglia; non adatto a utenti che non si fidano tra loro.
- Dashboard e saldi si calcolano nel browser leggendo i movimenti del periodo: con Firestore ogni documento letto conta sulla quota di 50.000 letture al giorno. Per una famiglia basta, ma il data model deve evitare letture inutili (cache persistente, filtri per periodo, eventuali documenti riassuntivi mensili).
- Due backend significano due implementazioni dell'adapter e due modi di esprimere i vincoli (regole Firestore e SQL); la suite di contract test è obbligatoria, non opzionale.
- Le regole Firestore non sanno sommare liste: il controllo "le quote fanno 100%" in modalità Firebase lo garantisce solo `core`.
- Senza Cloud Storage niente allegati (ricevute, foto) in modalità Firebase.
- In modalità server le scritture offline non ci sono.
- `uv` va installato a parte (o si usa Docker).

**Neutral**:
- Il prototipo PHP resta nel repository come riferimento finché la slice 1 non lo sostituisce.
- Il passaggio a TypeScript 7 è previsto quando il lint lo supporta.
- La lingua inglese (feature 22) richiederà una libreria di traduzione; per ora i testi stanno in un catalogo tipizzato `apps/web/src/i18n/it.ts` con una piccola funzione `t()`, così il passaggio sarà meccanico.

## Follow-up

- [ ] Feature 3 (data model): definire collezioni Firestore e tabelle SQL con la stessa forma, gli indici, e la strategia per limitare le letture Firestore.
- [ ] Feature 2 (tooling): confermare ESLint, Prettier, Ruff, il gestore dei hook di commit e la regola che vieta IO in `packages/core`.
- [ ] Feature 19 (notifiche): definire il ciclo di invio nel server e i limiti in modalità Firebase.
- [ ] Nuova feature: backup e spostamento dei dati tra modalità (export completo JSON da un backend, import nell'altro; backup del file SQLite).
- [ ] Nessuna skill della community è registrata per React, Vite, Firebase o FastAPI; valuta se installarne qualcuna e annotarla nel `AGENTS.md` radice (feature 2).

