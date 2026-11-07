# Import automatico dalla banca (open banking)

Invece di scaricare il CSV dalla banca, Noi2Contiamo può leggere i movimenti direttamente dal conto. Si usa **Enable Banking** (<https://enablebanking.com>), un servizio europeo gratuito per uso personale e non commerciale: copre circa 2500 banche dell'area UE/SEE.

In questa modalità ("restricted mode") l'app Enable Banking può leggere **solo i conti che colleghi tu**, cioè i tuoi. Il consenso alla banca dura al massimo 180 giorni (spesso 90): alla scadenza basta ricollegare la banca.

Il browser non può parlare direttamente con Enable Banking, quindi serve sempre un piccolo servizio che firma le richieste con la tua chiave privata. Ci sono **tre modi**, scelti in automatico dall'app (sezione _Importa_, scheda _Dal conto bancario_).

| Dove gira l'app | Come arrivano i movimenti |
|---|---|
| Server Python (locale o Docker) | Il server fa da intermediario. Le chiavi stanno in due variabili d'ambiente. |
| Firebase, piano **Blaze** | Una Cloud Function (`bank`) fa da intermediario. Le chiavi stanno in Firestore, illeggibili dal browser. |
| Firebase, piano **Spark** (gratuito) | Niente funzioni: lo script `npm run bank:csv` scarica un CSV da importare con _Da file CSV_. |

## 1. Registrare l'app su Enable Banking (una volta sola)

1. Entra in <https://enablebanking.com/sign-in/> e crea l'account.
2. Nel **Control Panel** crea una nuova applicazione di tipo **PRODUCTION**.
3. Genera la chiave privata e il certificato pubblico (servono `openssl`, già presente su macOS e Linux, su Windows con Git Bash):
   ```bash
   openssl genrsa -out private.key 4096
   openssl req -new -x509 -days 3650 -key private.key -out public.crt
   ```
4. Carica `public.crt` nell'applicazione. **`private.key` non va caricata né condivisa**: resta tua (il repository la ignora, come `*.pem` e `public.crt`).
5. Annota l'**Application ID**: è l'"App ID" che chiede Noi2Contiamo.
6. Nelle **Redirect URLs** aggiungi, secondo come usi l'app:
   - `https://<progetto>.web.app/importa/banca` (Firebase)
   - `http://localhost:5173/importa/banca` (sviluppo)
   - `http://localhost:8000/importa/banca` (server locale)
   - `https://localhost/` (solo per lo script `npm run bank:csv`)
7. Premi **Activate by linking accounts** e collega i tuoi conti. Finché non lo fai l'app non legge nulla.

## 2. Server Python (locale o Docker)

Metti la chiave in un file leggibile dal server e imposta, nel `.env`:

```
N2C_ENABLE_BANKING_APP_ID=<Application ID>
N2C_ENABLE_BANKING_KEY_FILE=/percorso/private.key
```

Vanno impostate insieme; con Docker monta il file come volume. Riavvia il server, apri _Importa > Dal conto bancario_, premi _Collega una banca_, scegli il paese e la banca, autorizza sul sito della banca: tornerai nell'app. Poi _Importa da qui_, scegli il conto della banca e quello dell'app, il periodo (proposto: dall'ultimo import dalla banca, altrimenti gli ultimi 90 giorni) e _Scarica movimenti_. Da lì anteprima, conferma e risultato sono quelli dell'import CSV: i doppioni si saltano e l'import si annulla con un tocco.

## 3. Firebase, piano Blaze (con la funzione)

La funzione sta in `apps/functions`. Il piano Blaze chiede una carta, ma **per una famiglia resta dentro la quota gratuita** (richieste, calcolo e Firestore sono molto sotto i limiti).

1. Passa il progetto al piano Blaze dalla console Firebase.
2. **Subito**, in _Fatturazione > Budget e avvisi_, crea un budget da **1 €** con avviso: se qualcosa va storto lo vedi.
3. Pubblica: `npm run firebase:publish` (prova anche la funzione) oppure solo la funzione con `npm run deploy:firebase:functions`.
4. Lo script imposta anche la pulizia automatica delle immagini in Artifact Registry (`firebase functions:artifacts:setpolicy --days 1`): senza, le immagini della funzione si accumulano e potrebbero superare lo spazio gratuito.
5. Apri _Importa > Dal conto bancario_ **come proprietario della famiglia**: compare il modulo per l'App ID e la chiave privata (file `private.key`). Premi _Salva e verifica_: la funzione controlla le credenziali con una chiamata di prova e le salva in Firestore (`bankingSecrets/<famiglia>`). La chiave non torna mai al browser.
6. Da qui si procede come per il server Python.

Limiti già impostati nella funzione: regione `europe-west1`, **una sola istanza** (`maxInstances: 1`), 256 MiB, nessuna istanza sempre accesa.

Con il piano Spark la pubblicazione della funzione viene saltata con un avviso, senza errori: il resto dell'app funziona normalmente.

## 4. Firebase, piano Spark: lo script `npm run bank:csv`

Dalla cartella del repository (serve Python gestito da `uv`, come per il server):

```bash
npm run bank:csv -- --app-id <Application ID> --key-file private.key
```

(oppure con le variabili `N2C_ENABLE_BANKING_APP_ID` e `N2C_ENABLE_BANKING_KEY_FILE`.) Lo script ti chiede il paese, cerca la banca per nome e ti dà un indirizzo da aprire per autorizzare. Alla fine il browser va su `https://localhost/` e **la pagina darà errore: è normale**. Copia l'indirizzo **completo** dalla barra del browser (contiene `?code=...&state=...`) e incollalo nello script. Poi scegli i conti e il periodo (predefinito: ultimi 90 giorni): per ogni conto scrive un file in `bank-csv/`.

Il CSV ha codifica UTF-8 con BOM, separatore `;`, intestazione `Data;Descrizione;Beneficiario;Importo`, date `gg/mm/aaaa`, importi con la virgola e il segno meno per le uscite, solo movimenti contabilizzati. In _Importa > Da file CSV_ le colonne si riconoscono da sole.

## Doppioni tra banca e CSV

Il controllo dei doppioni usa conto, data, importo e descrizione. La banca può scrivere la descrizione in modo diverso dall'estratto CSV della stessa banca: in quel caso un movimento importato prima da CSV e poi dalla banca può comparire due volte. Meglio scegliere una sola fonte per ogni conto (il CSV di `bank:csv` e l'import diretto scrivono la stessa descrizione, quindi tra loro non si duplicano).

## Sicurezza

- La **chiave privata non viene mai rimandata al browser**: sul server sta in un file, con la funzione in Firestore.
- Le regole di Firestore **negano qualsiasi lettura e scrittura** a `bankingSecrets/**` ai client, anche al proprietario. Solo la funzione, con l'Admin SDK, la legge.
- Solo il proprietario della famiglia configura la chiave. Ogni banca collegata è visibile e usabile solo da chi l'ha collegata.
- La modalità "restricted" di Enable Banking limita l'accesso ai conti che hai collegato tu; il consenso scade in massimo 180 giorni e puoi revocarlo con _Scollega_.
- Non committare mai `private.key`: `.gitignore` esclude `*.key`, `*.pem`, `public.crt` e la cartella `bank-csv/`.

## Cosa non è verificato

Il codice è provato con servizi finti (nessuna chiamata reale a Enable Banking, nessun deploy reale su Firebase). La prima volta che colleghi una banca vera controlla l'importo e le date nell'anteprima prima di confermare.
