# 0001. Stack e architettura: decision record

Questo file è il perché dello spec [index.md](index.md). `/develop` può saltarlo.

## Context

Noi2Contiamo è una app di contabilità per una coppia o una famiglia, open source, pensata per uso privato e per chiunque voglia installarla in casa. Pochi utenti per installazione (2 a 5), qualche migliaio di movimenti all'anno, interfaccia in italiano, uso soprattutto da telefono. Il prototipo esistente (PHP, `api.php`, `script.js`, `noi2contiamo.sql`) mostra le funzioni attese ma ha problemi di sicurezza noti (password in chiaro nei dati demo, cancellazioni senza controllo di famiglia, HTML iniettabile) e verrà sostituito, non migrato.

Il vincolo più forte è il costo zero con due modi di installazione dallo stesso codice. Il primo è un progetto Firebase personale sul piano gratuito Spark: qui non esistono Cloud Functions (servono il piano Blaze) e, per i nuovi progetti, nemmeno Cloud Storage; il solo codice che gira "sul server" sono le Security Rules di Firestore, che validano ma non calcolano (niente cicli, niente somme su liste). Il secondo è un server Python in casa, avviabile con un comando o in Docker, con SQLite di default.

Le funzioni previste sono ricche di logica: divisione delle spese in percentuale con arrotondamento al centesimo, regole automatiche ordinate, riconoscimento e previsione delle ricorrenze, parsing di CSV di banche diverse con profili salvati, giroconti e saldo tra membri, aggregati per le dashboard, export CSV e PDF. Se questa logica vivesse nei backend andrebbe scritta due volte (una in Python, una in qualcosa che Firebase Spark non può eseguire), con il rischio certo che le due versioni divergano.

Altri vincoli: importi esatti (niente virgola mobile), isolamento dei dati per famiglia in entrambe le modalità, notifiche solo con canali gratuiti, test che girano in locale senza pesare sulla CI. Il team è una persona, aiutata da agenti di codice: la semplicità operativa conta più di tutto.

## Options considered

### Option 1: Dominio TypeScript condiviso nel browser, due adapter sottili

Un monorepo con `packages/core` (logica pura), `packages/data` (interfaccia `DataAdapter` con implementazioni Firebase e HTTP) e `apps/web` (React). Firebase Spark e un server FastAPI fanno solo login, isolamento per famiglia e controlli di integrità di base.

**Pros**:
- Ogni regola esiste una volta e si testa con Vitest senza database.
- Rispetta il limite del piano Spark per costruzione: non c'è logica da eseguire sul server.
- Il server Python è piccolo, facile da mantenere e da leggere per chi installa.

**Cons**:
- Il server si fida del client per i calcoli di dominio.
- Gli aggregati si calcolano leggendo i movimenti nel browser, il che consuma letture Firestore.
- Due adapter da tenere allineati con una suite di contract test.

### Option 2: Logica nel server Python, Firebase solo come hosting

Tutta la logica in FastAPI; per la modalità "cloud gratuito" si usa un hosting gratuito per container (per esempio un piano free di una piattaforma PaaS) invece di Firestore.

**Pros**:
- Il server è la sola fonte di verità e valida tutto.
- Un solo backend, niente regole Firestore.

**Cons**:
- I piani gratuiti per container cambiano spesso, dormono dopo inattività o richiedono una carta; contraddice "sempre raggiungibile, nessun abbonamento".
- Va contro la scelta esplicita di Firebase Spark fatta dall'utente.
- Niente offline e niente promemoria senza server acceso.

### Option 3: Logica duplicata in ogni backend (Python e regole/client Firebase)

Il server Python calcola tutto lato server; in modalità Firebase la stessa logica viene riscritta nel client.

**Pros**:
- In modalità server i calcoli sono garantiti dal server.

**Cons**:
- Ogni regola scritta due volte, in due linguaggi, con divergenze inevitabili (arrotondamenti, date, parsing CSV).
- Doppio costo di test per ogni slice.

### Option 4: Backend unico alternativo self hosted (PocketBase o Supabase in casa) più Firebase

Un BaaS open source in casa al posto di FastAPI.

**Pros**:
- Auth e API pronti senza scrivere un server.

**Cons**:
- L'utente ha scelto Python con FastAPI e SQLAlchemy; Supabase in casa richiede molti container, PocketBase è Go con estensioni in JavaScript, entrambi lontani dalle competenze dichiarate.
- Due BaaS diversi da far combaciare restano due adapter comunque.

## Rationale

L'opzione 1 è l'unica che rispetta insieme il piano Spark (nessun calcolo possibile sul server), il server locale e il divieto di duplicare la logica. Mettere il dominio nel browser trasforma il problema da "due backend con la stessa logica" a "due magazzini dietro la stessa interfaccia", che è molto più facile da tenere allineato con una suite di contract test. Il prezzo è la fiducia nel client: per un'app privata dove i membri della famiglia si fidano tra loro è un compromesso accettabile, e i controlli che contano davvero per la sicurezza (chi vede quali dati) restano sul server in entrambe le modalità.

Le scelte di dettaglio seguono lo stesso criterio di semplicità.

- **npm workspaces invece di pnpm**: npm 11 è già installato, i pacchetti sono tre e non serve il risparmio di spazio di pnpm; pnpm sarebbe più rigoroso sulle dipendenze non dichiarate, rischio che copriamo con il lint.
- **TypeScript 6.0 invece di 7**: TypeScript 7 è il nuovo compilatore nativo, ma `typescript-eslint` oggi accetta solo versioni sotto la 6.1.
- **SQLAlchemy sincrono**: con SQLite e una famiglia l'async non porta niente e aggiunge driver e complessità.
- **Sessioni con cookie invece di JWT**: il server serve anche il frontend (stessa origine), le sessioni sono revocabili e non c'è refresh token da gestire; Argon2id via `pwdlib` è la libreria che la documentazione FastAPI usa oggi (runner up: `fastapi-users`, più pesante e in sola manutenzione).
- **UUIDv7 dal client**: lo stesso ID vale in Firestore e in SQL, permette di scrivere offline su Firestore e di creare più documenti collegati in un solo `commit`.
- **Percentuali in punti base**: interi come gli importi, così l'arrotondamento al centesimo è deterministico in entrambe le modalità (il metodo preciso lo fissa lo spec della divisione spese).
- **Contratto HTTP generato da OpenAPI**: FastAPI produce lo schema; `openapi-typescript` crea i tipi, quindi i tipi TypeScript dell'adapter non si scrivono a mano.
- **Promemoria calcolati dal client e inviati dal server**: tiene la logica delle ricorrenze in `core` e lascia al server Python solo il compito di inviare all'ora giusta.
- **`uv` per Python**: un comando installa la versione di Python giusta e le dipendenze bloccate; `pip` e `venv` restano un'alternativa documentabile.
- **Nessuna libreria di traduzione per ora**: un catalogo tipizzato basta per una lingua; il feature 22 sceglierà la libreria.

## Evidenze: versioni verificate

Versioni lette con `npm view` e `pip index versions` il 2026-11-03: react 19.3.1, vite 8.3.5, @vitejs/plugin-react 6.2.1 (richiede vite ^8), vite-plugin-pwa 2.0.0 (accetta vite ^8), react-router 8.5.1, @tanstack/react-query 5.105.3, zod 4.6.7, date-fns 4.4.0, uuid 14.0.3, firebase 13.2.0, firebase-tools 15.34.2, @firebase/rules-unit-testing 6.0.0, openapi-typescript 7.13.0, openapi-fetch 0.17.0, vitest 5.1.0, @testing-library/react 16.3.3, concurrently 10.0.6, typescript latest 7.0.2 (scelta 6.0.3), typescript-eslint 8.72.1 (peer typescript <6.1.0), eslint 10.14.0, prettier 3.9.10; fastapi 0.162.0, sqlalchemy 2.1.6, alembic 1.20.1, pydantic 2.14.2, pydantic-settings 2.16.2, uvicorn 0.54.0, pwdlib 0.3.1, psycopg 3.3.7, pytest 9.2.0, httpx 0.28.1, pywebpush 2.5.0, uv 0.13.7, ruff 0.17.3. Sulla macchina di sviluppo: Python 3.12.10, `uv` e Docker non installati.
