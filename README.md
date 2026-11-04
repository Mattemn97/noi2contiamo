# Noi2Contiamo

[![Licenza MIT](https://img.shields.io/github/license/Mattemn97/noi2contiamo)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/Mattemn97/noi2contiamo)](https://github.com/Mattemn97/noi2contiamo/releases)

Web app open source per tenere la contabilità di coppia e di famiglia. Ognuno si registra, crea o entra in una famiglia, registra o importa i movimenti, divide le spese e vede chi deve quanto a chi. Pensata per uso privato e da installare in casa (self hosted), senza abbonamenti. L'interfaccia è in italiano, funziona da telefono (PWA) ed è disponibile in tema chiaro e scuro.

Licenza [MIT](./LICENSE).

> **English summary.** Noi2Contiamo is an open source, self hosted personal finance app for couples and families: shared expense splitting, member balance settlement, bank CSV import with saved profiles, automatic rules, recurring payments and forecasts, dashboards, PDF and CSV reports. React + TypeScript PWA, with a Python (FastAPI + SQLite) server or Firebase free plan. The interface is in Italian.

## Stato del progetto

Versione `1.0.0`. La modalità con server Python e la pubblicazione su Firebase sono state provate su un'installazione reale, ma i test automatici delle regole Firestore (emulatore, serve Java 21) non sono ancora stati eseguiti. Non sono ancora stati provati:

- l'immagine Docker e `compose.yaml`;
- l'invio vero di email e Telegram.

Se ne provi una e qualcosa non va, apri una [issue](https://github.com/Mattemn97/noi2contiamo/issues).

## Cosa fa

- Conti, categorie e destinatari; movimenti di entrata, uscita e giroconto, con filtri e ricerca.
- Divisione delle spese tra i membri (50/50 o altre quote) e saldo finale: chi deve quanto a chi.
- Movimenti e conti privati, visibili solo a chi li possiede.
- Import da CSV delle banche (Intesa, PayPal, Revolut, Satispay e formati simili) con profili salvati e controllo dei doppioni.
- Regole automatiche che assegnano categoria e destinatario, con anteprima prima di applicarle.
- Pagamenti ricorrenti e previsioni dei mesi successivi.
- Dashboard di coppia, area personale e confronto tra periodi.
- Export CSV e report PDF del periodo.
- Promemoria nell'app, notifiche del browser, email e Telegram (questi ultimi solo con il server Python).
- Inviti per far entrare altri membri nella famiglia.

Gli importi sono sempre interi in centesimi: nessun arrotondamento sui decimali.

## Tre modi di installarla

Tutti e tre usano la stessa interfaccia. Scegli in base a dove vuoi tenere i dati.

| Modo           | Dati su                            | Serve                                               |
| -------------- | ---------------------------------- | --------------------------------------------------- |
| Locale         | SQLite sul tuo computer            | Node.js 22 o più recente, Python 3.12 o più recente |
| Docker         | SQLite (o PostgreSQL) in un volume | Docker con Compose                                  |
| Firebase Spark | Cloud Firestore, piano gratuito    | Un account Google e Node.js                         |

### 1. Locale (un comando)

```bash
npm install
node scripts/uv.mjs sync --project server    # dipendenze Python (se `uv` non è nel PATH ci pensa lo script)
npm run local
```

`npm run local` compila il frontend e avvia il server su <http://localhost:8000>. Il database è `data/noi2contiamo.db` (si crea da solo, le migrazioni sono automatiche). In sviluppo, senza `N2C_SECRET_KEY`, le sessioni si perdono a ogni riavvio: per tenerle imposta la variabile (vedi `.env.example`).

Per provarla con dati inventati: `npm run demo` (solo modalità Python) crea la famiglia "Casa Demo" con due utenti, `giulia.demo@example.com` e `marco.demo@example.com`, password `demo-password-2026`. Non usarla su un'installazione vera.

Per sviluppare con ricaricamento automatico: `npm run dev:local` (Vite su :5173 e server su :8000).

### 2. Docker

1. Copia `.env.example` in `.env`.
2. Genera un segreto e mettilo in `N2C_SECRET_KEY` nel file `.env`:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
3. Avvia:
   ```bash
   docker compose up -d --build
   ```
4. Apri <http://localhost:8000>.

I dati stanno nel volume `n2c-data` (`/data` nel container): fai il backup di quel volume. Il container gira con `N2C_ENV=production`, quindi rifiuta di partire senza `N2C_SECRET_KEY`, e i cookie di sessione sono `Secure` tranne su `localhost`. Per usarla in rete locale via `http://` (senza HTTPS) imposta `N2C_COOKIE_SECURE=false`; per un uso fuori casa metti davanti un proxy con HTTPS. Per i dati demo: `docker compose exec app python -m noi2contiamo_server.demo`.

Il file `compose.yaml` include un servizio PostgreSQL facoltativo (`--profile postgres`), ma il driver non è tra le dipendenze del server: di default si usa SQLite.

### 3. Firebase (piano Spark, gratuito)

Con Node.js installato, dalla cartella del repository:

```bash
npm install
npm run firebase:publish
```

Lo script fa l'accesso a Google, ti chiede l'ID di un progetto esistente oppure ti guida a crearne uno nuovo, poi prepara app web, database e login, compila e pubblica sito, regole e indici. Se un passaggio automatico non riesce ti dà il link per farlo a mano e aspetta. Con un progetto già pronto: `npm run firebase:publish -- --project <id>`. Rilancialo per pubblicare una versione nuova: i dati restano.

Serve solo un account Google: il piano Spark è gratuito e non chiede dati di pagamento. Il sito finisce su `https://<id-progetto>.web.app`.

> **Dopo la prima pubblicazione aspetta qualche minuto.** Firestore deve costruire gli indici: finché non sono pronti, dopo l'accesso l'app può mostrare "Qualcosa è andato storto". Non è un guasto: attendi e premi _Riprova_. Lo stato si vede in _Firestore Database > Indici_ nella console.

La procedura a mano, se preferisci:

1. Vai su <https://console.firebase.google.com> e crea un progetto (puoi lasciare Google Analytics spento). Resta sul piano **Spark**: non serve la carta e non devi passare a Blaze.
2. In _Build > Authentication_ premi _Inizia_ e abilita il provider **Email/password**.
3. In _Build > Firestore Database_ premi _Crea database_, scegli una regione europea e la modalità di produzione (le regole le carichiamo noi).
4. In _Impostazioni progetto > Le tue app_ aggiungi un'app **Web** e copia la configurazione (`apiKey`, `authDomain`, `projectId`, `appId`). Sono valori pubblici: la sicurezza sta nelle regole di Firestore.
5. Nel repository:
   ```bash
   cp .env.example .env
   cp .firebaserc.example .firebaserc
   ```
   In `.env` imposta `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. In `.firebaserc` sostituisci `il-tuo-progetto-firebase` con l'ID del progetto.
6. Accedi e pubblica regole, indici e sito:
   ```bash
   npx firebase-tools@15.34 login
   npm run deploy:firebase
   ```
7. Apri l'indirizzo `https://<id-progetto>.web.app`. Dopo il primo deploy gli indici di Firestore possono impiegare qualche minuto a essere pronti.

**Limiti onesti della modalità Firebase**

- Niente email né Telegram: servirebbero Cloud Functions, che richiedono il piano Blaze. I promemoria restano nell'app e come notifiche del browser, e si calcolano quando apri l'app.
- Valgono le quote gratuite di Spark (letture, scritture e spazio di Firestore): per una famiglia bastano, ma non sono illimitate.
- Le regole di sicurezza controllano chi può leggere e scrivere, ma non possono fare tutti i controlli del server Python; alcune verifiche stanno nel browser.
- I dati stanno nel tuo progetto Google: sei tu a gestire backup (export di Firestore) e accessi.
- Non c'è un passaggio automatico dei dati tra Firebase e server Python.

Per provare Firebase in locale senza cloud c'è l'emulatore: `npm run dev:firebase` con `VITE_USE_FIREBASE_EMULATOR=true` (serve Java per l'emulatore di Firestore).

## Promemoria e notifiche

- **Nell'app e nel browser**: funzionano in tutti i modi, senza configurare nulla. In _Altro > Impostazioni promemoria_ scegli i canali.
- **Email** (solo server Python): imposta in `.env` `N2C_SMTP_HOST`, `N2C_SMTP_PORT`, `N2C_SMTP_USER`, `N2C_SMTP_PASSWORD`, `N2C_SMTP_FROM` e `N2C_SMTP_SECURITY` (`starttls`, `ssl` o `none`).
- **Telegram** (solo server Python): crea un bot con @BotFather, imposta `N2C_TELEGRAM_BOT_TOKEN` e `N2C_TELEGRAM_CHAT_ID` (il chat id si ricava scrivendo al bot o aggiungendolo a un gruppo). Vanno impostati insieme.
- Senza queste variabili il canale resta spento. Il server controlla i promemoria ogni `N2C_REMINDER_INTERVAL_SECONDS` secondi; i nuovi promemoria partono dopo che qualcuno ha aperto l'app, perché è il browser a calcolarli.

## Test

```bash
npm run check          # tipi, lint e tutti i test: prima di dire "fatto"
npm run test:ts        # solo Vitest (dominio, adapter, interfaccia)
npm run test:py        # solo pytest (server)
npm run test:rules     # regole Firestore sull'emulatore (serve Java)
npm run test:contract:http
```

Tutto gira in locale, non serve una CI. Al commit un hook lancia ESLint, Prettier e Ruff sui file in stage.

## Primi passi, fino al primo movimento

1. Apri l'app e scegli _Crea il tuo account_: bastano email e password (almeno 8 caratteri).
2. Nella schermata _Crea la tua famiglia_ dai un nome alla famiglia e il tuo nome da mostrare. Diventi il proprietario e ricevi un primo conto e le categorie di base.
3. Per far entrare l'altra persona: _Altro > Famiglia e inviti_, crea un invito e mandale il link; lei si registra e lo accetta.
4. Premi _Aggiungi_ nella barra in basso (_Nuovo movimento_), scegli tipo, data, importo, conto e categoria, e salva.
5. Il movimento compare in _Movimenti_; il saldo tra i membri è in _Altro > Saldo tra i membri_. Per caricare un estratto conto usa l'import CSV.

## Per chi sviluppa

Monorepo npm: `apps/web` (React 19 e Vite), `packages/core` (dominio puro in TypeScript), `packages/data` (interfaccia `DataAdapter`: memoria, Firebase, HTTP), `server/` (FastAPI, SQLAlchemy, Alembic), `firebase/` (regole e indici). Le decisioni di progetto stanno in `docs/specs/`, la mappa delle funzioni in `docs/scope/scope.md`. Vedi anche [CONTRIBUTING.md](./CONTRIBUTING.md).
