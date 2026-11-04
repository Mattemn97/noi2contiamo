# 0002. Data model: decision record

## Context

Spec 0001 ha fissato due backend intercambiabili (Firestore sul piano Spark e un server FastAPI con SQLite o PostgreSQL) dietro un solo `DataAdapter`, con tutta la logica nel browser. Il data model deve quindi avere una forma che entrambi sappiano salvare senza logica propria, che le regole Firestore possano controllare senza sommare liste e senza query, e che il server possa vincolare con chiavi esterne e CHECK.

Le slice previste chiedono molto al modello: quote tra membri in percentuale o importo esatte al centesimo, giroconti e pareggi, conti privati, regole ordinate, profili e lotti di import con deduplica, ricorrenze collegate ai movimenti reali, promemoria per membro. Il modello deve reggerle tutte senza migrazioni distruttive, perché ogni migrazione va scritta due volte (Alembic e documenti Firestore).

Forze principali: quota di 50.000 letture al giorno su Firestore; regole Firestore che leggono altri documenti solo per percorso; fiducia di famiglia (il server non ricalcola); feature 23 che chiede di spostare una famiglia tra backend in cui l'identità di login è diversa (uid Firebase contro utenti del server). Il modo di lavorare è non interattivo: le scelte sotto sono le raccomandate, ognuna con il suo perché.

## Options considered

### Option 1: schema relazionale classico, documenti Firestore ricavati

Si progettano tabelle normalizzate (quote in tabella figlia, condizioni delle regole in tabelle, colonne CSV in righe) e l'adapter Firebase traduce in documenti.

**Pros**:
- Vincoli SQL completi su ogni dato.
- Query arbitrarie nel server.

**Cons**:
- Due forme diverse da tenere allineate e una traduzione per ogni collezione nell'adapter Firebase.
- L'export tra modalità diventa una conversione, non una copia.
- Le query arbitrarie nel server non servono: la logica sta nel browser.

### Option 2: collezioni tipizzate a documenti, stessa forma; SQL con colonne vere più JSON (scelta)

Ogni collezione ha uno schema zod in `core`; Firestore salva il documento così com'è, SQL usa colonne vere per i campi interrogati, vincolati o referenziati e una colonna JSON per gli oggetti annidati.

**Pros**:
- Una sola forma, un solo schema, export uguale a una copia.
- Chiavi esterne e unicità dove contano (riferimenti, impronte, email).
- Adapter generici sulle collezioni, pochi casi speciali.

**Cons**:
- Il contenuto JSON non ha vincoli SQL (li dà Pydantic).
- Alcuni campi copiati (visibilità, proprietario) per servire le regole Firestore.

### Option 3: un'unica tabella generica `documents(family_id, collection, id, data JSON)`

**Pros**:
- Server minimo, nessuna migrazione per nuove collezioni.

**Cons**:
- Niente chiavi esterne, niente unicità sulle impronte, indici solo su espressioni JSON.
- Il server diventa un Firestore fatto a mano, senza i vantaggi di SQL.

## Rationale

Option 2 segue la forza principale di spec 0001: un solo dominio e backend sottili. Con la stessa forma dei documenti, l'adapter Firebase non traduce niente e l'export della feature 23 è una copia con gli stessi id. Le colonne vere in SQL servono proprio i punti dove un vincolo nel database evita danni reali: riferimenti a conti e categorie, impronte di import uniche, email e token unici. Option 3 butterebbe via questi vincoli; Option 1 raddoppierebbe il lavoro su ogni slice.

Scelte puntuali (prese con l'opzione raccomandata, una riga di perché ciascuna):
- **`memberId` separato da `userId`**: l'identità di login cambia tra backend e il partner può non avere ancora un account; runner up: usare l'uid come id del membro (rompe l'export).
- **Documento `access/{uid}` in Firestore**: le regole leggono per percorso, quindi serve un documento indicizzato per uid; nel server basta una join.
- **Importi positivi con `type` e `isRefund`**: niente segni ambigui; il segno del CSV si normalizza all'import; runner up: importo con segno (più errori nei totali per categoria).
- **Divisione salvata sul movimento (fotografia)**: un saldo già pareggiato non deve cambiare se domani cambia la divisione della categoria; runner up: calcolarla alla lettura (cambia il passato).
- **Quote in mappa `{ memberId: valore }`**: le regole Firestore controllano le chiavi con `keys().hasOnly`; runner up: lista di oggetti.
- **Resto più grande con pareggi per `memberId`**: somma esatta e risultato deterministico; runner up: centesimo al pagatore (dipende da un campo in più).
- **Date `YYYY-MM-DD` e istanti in millisecondi**: portabili, ordinabili, confrontabili nelle regole con `request.time.toMillis()`; runner up: Timestamp Firestore (conversione in ogni adapter).
- **Visibilità copiata sul movimento**: le regole Firestore accettano solo query che vincolano i campi che controllano; runner up: sottocollezioni per membro (moltiplica le query).
- **Filtri secondari in `core` sul periodo già letto**: pochi indici, nessuna lettura in più al cambio filtro; runner up: un indice per ogni combinazione.
- **Nessun documento riassuntivo**: circa 200 movimenti al mese, un anno intero sta sotto 3.000 letture; si aggiungono solo se misurato.
- **Impronta con occorrenza nel file**: due caffè identici lo stesso giorno restano due movimenti; runner up: impronta senza occorrenza (li fonde).
- **Ricorrenze senza scadenze salvate**: si calcolano da frequenza e collegamenti, così non vanno mai rigenerate; si salvano solo i salti e i suggerimenti scartati.
- **Ultima scrittura vince**: due persone, conflitti rari; un campo `version` complicherebbe le scritture offline.
- **Token di invito a 128 bit, non UUIDv7**: un UUIDv7 è in parte prevedibile dal tempo.
- **Una valuta per famiglia**: uso di coppia in Italia; multi valuta toccherebbe ogni totale.
- **`@noble/hashes` in `core`**: SHA-256 puro TypeScript, rispetta il divieto di API del browser in `core`; runner up: WebCrypto nell'adapter (sposta logica fuori da `core`).
