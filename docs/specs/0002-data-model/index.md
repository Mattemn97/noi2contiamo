# 0002. Data model: documenti per famiglia, stessa forma in Firestore e in SQL

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Questo spec fissa tutte le entità dell'app (famiglie, membri, conti, categorie, destinatari, movimenti con le quote, regole, profili e lotti di import, ricorrenze, promemoria) e come si salvano nei due backend. Ogni dato vive dentro una famiglia: in Firestore sotto `families/{familyId}/...`, nel server Python in tabelle con `family_id`. I documenti hanno la stessa forma JSON ovunque (id UUIDv7, importi in centesimi interi, date `YYYY-MM-DD`, istanti in millisecondi), così lo stesso `DataAdapter` li legge e li scrive e un export JSON può spostare una famiglia da un backend all'altro. Il membro (`memberId`) è separato dall'account di login (`userId`): tutte le quote e gli autori puntano al membro, così l'identità di login può cambiare senza riscrivere i dati.

## Requirements

**User stories**:
- Come membro di una famiglia, voglio che ogni importo e ogni quota tornino al centesimo, così il saldo tra noi è sempre giusto.
- Come persona con un conto personale privato, voglio che l'altro membro non veda quel conto né i suoi movimenti non condivisi.
- Come sviluppatore, voglio un solo modello dati che regga tutte le slice previste senza migrazioni distruttive.
- Come persona che cambia modalità di installazione, voglio esportare la famiglia da un backend e reimportarla nell'altro senza perdere niente (feature 23).

**Acceptance criteria**:
- **AC-1**: `packages/core` esporta uno schema zod per ogni collezione elencata in *Collezioni*; un documento valido passa, un documento con importo non intero, percentuale fuori da 0..10000, data non `YYYY-MM-DD`, id non UUIDv7 (dove richiesto) o campo sconosciuto viene rifiutato con un errore come valore (`Result`). Un campo opzionale assente riceve il suo default alla lettura.
- **AC-2**: le invarianti del movimento sono verificate da `core`: `amountCents` intero > 0; `transfer` ha `toAccountId` diverso da `accountId`, niente categoria e niente `split`; `income`/`expense` usano una categoria dello stesso `kind`; le quote sommano esattamente a 10000 (punti base) o a `amountCents` (centesimi); `visibility: "private"` solo se il conto è privato e l'unico membro nelle quote è il proprietario.
- **AC-3**: `allocateShares(amountCents, shares)` restituisce centesimi interi la cui somma è esattamente `amountCents`, con il metodo del resto più grande e pareggi risolti per `memberId` crescente; lo stesso input dà lo stesso output qualunque sia l'ordine delle chiavi (esempio: 100 centesimi su 3333/3333/3334 punti base → 33/33/34, con il centesimo in più al resto maggiore).
- **AC-4**: la suite di contract test copre `get`, `put`, `remove`, `list` con ogni query ammessa (uguaglianza sui campi indicizzati, intervallo di date, ordine `date` decrescente poi `id`, `limit`, cursore) e `commit` atomico; passa su `memory` e `http`, e su `firebase` con l'emulatore.
- **AC-5**: isolamento: un utente che non è membro della famiglia F riceve un rifiuto su ogni collezione di F in entrambi i backend; un membro non legge né scrive un conto privato o un movimento privato di un altro membro; in Firestore una query sui movimenti senza il vincolo di visibilità viene rifiutata, nel server viene filtrata.
- **AC-6**: l'impronta di import (`importFingerprint`) di una riga CSV è stabile tra due import dello stesso file; due righe identiche nello stesso file hanno impronte diverse (indice di occorrenza); il server rifiuta con `409` una seconda riga con la stessa impronta nella stessa famiglia.
- **AC-7**: membri e inviti: creare una famiglia scrive in modo atomico famiglia, membro proprietario e accesso; accettare un invito valido crea l'accesso e segna l'invito come usato; un invito scaduto, revocato o già usato viene rifiutato; l'ultimo proprietario non può lasciare la famiglia.
- **AC-8**: un export completo di una famiglia (formato `noi2contiamo-export` v1) reimportato in un altro adapter produce documenti identici con gli stessi id; i membri importati hanno `userId: null` finché un utente non li reclama.

## Decision

**Chosen option**: Option 2: collezioni tipizzate a documenti, stessa forma JSON nei due backend; in SQL colonne vere per i campi interrogati e vincolati, JSON per gli oggetti annidati.

Un registro di collezioni in `core` definisce schema, campi interrogabili e regole di visibilità di ognuna; `DataAdapter` resta generico sulle collezioni ma accetta solo le query dichiarate, più una piccola API `membership` per le operazioni che toccano l'accesso.

## Rationale

Ragionamento, contesto e opzioni scartate: vedi [rationale.md](rationale.md).

## Feature design

### Convenzioni comuni (tutte le collezioni)

| Concetto | Forma | Perché |
|---|---|---|
| `id` | UUIDv7 stringa, generato dal client | Stesso id nei due backend, ordinabile nel tempo, scritture offline su Firestore. |
| `userId` | stringa opaca (uid Firebase oppure UUIDv7 del server) | L'identità di login dipende dal backend; per questo i dati puntano a `memberId`. |
| Denaro | `...Cents`: intero sicuro (`Number.isSafeInteger`); in SQL `BIGINT` | Esatto, mai decimali. |
| Percentuali | `...Bp`: intero 0..10000 | 10000 = 100%. |
| Data di calendario | `date`: stringa `YYYY-MM-DD`, senza fuso | È il giorno dell'estratto conto; confronto e intervallo lessicografico funzionano. |
| Istante | `...AtMs`: intero, millisecondi UTC; in SQL `BIGINT` | Portabile; nelle regole si confronta con `request.time.toMillis()`. |
| Audit minimo | `createdAtMs`, `createdByMemberId`, `updatedAtMs`, `updatedByMemberId` su ogni documento di famiglia | Chi ha fatto cosa, senza un log separato. |
| Archiviazione | `archivedAtMs: number \| null` | Niente cancellazione logica: archiviato resta visibile nello storico, fuori dalle scelte nuove. |
| Testo normalizzato | `normalize(s)`: minuscolo, senza accenti (NFD), spazi compressi, trim | Usato per unicità dei nomi, regole e impronte. |
| Concorrenza | ultima scrittura vince, a livello di documento | Due persone, conflitti rari; nessun campo `version`. |
| Evoluzione | solo campi aggiunti e opzionali con default zod; `families.schemaVersion` intero per eventuali migrazioni di famiglia | Nessuna migrazione distruttiva. |

### Collezioni

Globali (fuori dalla famiglia): `users`, `inviteTokens` (solo Firebase; nel server è la tabella `invites` con l'hash del token). Di famiglia: tutte le altre.

**users** (`users/{userId}` in Firestore; tabella `users` nel server)
- `email` (req, minuscolo, unico), `displayName` (req, 1..60), `createdAtMs`.
- Solo server: `password_hash` (Argon2id), tabella `sessions` (`id`, `user_id`, `token_hash` unico, `created_at_ms`, `expires_at_ms`, `last_seen_at_ms`). Mai esportati.

**families** (`families/{familyId}`)
- `name` (req, 1..60), `currency` (req, ISO 4217, default `EUR`, fisso), `defaultSplit` (`SplitSpec`, req, default parti uguali tra i membri attivi alla creazione), `schemaVersion` (int, 1), `createdByUserId`, audit.

**members** (`families/{f}/members/{memberId}`): la persona nella famiglia, anche senza account (per esempio il partner non ancora registrato).
- `displayName` (req), `userId` (nullable, unico per famiglia), `role` (`owner` | `member`), `color` (nullable), `joinedAtMs`, `leftAtMs` (nullable), audit.
- Chi esce resta come documento (lo storico lo cita), con `leftAtMs` e `userId` mantenuto; perde solo l'accesso.

**access** (`families/{f}/access/{userId}`, solo Firestore; nel server è una join su `members.user_id`)
- `memberId` (req), `role` (copia di `members.role`), `inviteToken` (nullable: il token usato per entrare, che le regole controllano su `inviteTokens` con `familyId` uguale a `f`). Esiste se e solo se l'utente è membro attivo. È il documento che le regole leggono.

**invites** (`families/{f}/invites/{inviteId}`)
- `role` (default `member`), `memberId` (nullable: lega l'invito a un membro segnaposto esistente; null = crea un membro nuovo), `expiresAtMs` (default creazione + 7 giorni), `usedAtMs`, `usedByUserId`, `revokedAtMs` (nullable), audit.
- Token: 128 bit casuali in base32 (26 caratteri), mai UUIDv7 (indovinabile dal tempo). Firebase: documento globale `inviteTokens/{token}` con `familyId`, `inviteId`, `expiresAtMs`, `usedByUserId`. Server: colonna `token_hash` (SHA-256) unica, il token in chiaro si mostra una volta.

**accounts** (`families/{f}/accounts/{id}`)
- `name` (req, unico normalizzato tra i non archiviati), `kind` (`checking` | `savings` | `cash` | `card` | `other`), `ownerMemberId` (nullable: null = conto comune), `visibility` (`shared` | `private`; `private` richiede `ownerMemberId`), `initialBalanceCents` (int con segno, default 0), `initialBalanceDate` (`YYYY-MM-DD`), `order` (int), `archivedAtMs`, audit.
- Il saldo non si salva: `initialBalanceCents` + movimenti con `date >= initialBalanceDate`, calcolato in `core`.

**categories** (`families/{f}/categories/{id}`)
- `name` (req, unico normalizzato per `kind` e `parentId`), `kind` (`income` | `expense`), `parentId` (nullable, un solo livello), `defaultSplit` (`SplitSpec`, nullable: null = usa `families.defaultSplit`), `color`, `icon` (nullable), `order`, `archivedAtMs`, audit.

**payees** (`families/{f}/payees/{id}`)
- `name` (req), `normalizedName` (req, unico per famiglia), `archivedAtMs`, audit.

**transactions** (`families/{f}/transactions/{id}`)

| Campo | Tipo | Note |
|---|---|---|
| `type` | `income` \| `expense` \| `transfer` | |
| `date` | `YYYY-MM-DD` req | |
| `amountCents` | int > 0 req | Il verso lo dà `type`. |
| `isRefund` | bool, default false | Rimborso: per `expense` riduce la spesa della categoria, per `income` riduce l'entrata. |
| `accountId` | req | Conto di origine (per `transfer`) o del movimento. |
| `toAccountId` | nullable | Solo e obbligatorio per `transfer`. |
| `categoryId` | nullable | Vietato per `transfer`; null = da categorizzare. |
| `payeeId` | nullable | |
| `description` | string 0..500 | Testo originale (per regole e impronte). |
| `notes` | string 0..1000, nullable | |
| `payerMemberId` | nullable | Chi ha pagato; default dal `ownerMemberId` del conto al momento della scrittura; null = cassa comune. |
| `split` | `TransactionSplit`, nullable | Obbligatorio per `income`/`expense`, vietato per `transfer`. |
| `settlement` | `{ fromMemberId, toMemberId }`, nullable | Solo su `transfer`: segna un pareggio tra membri. |
| `visibility` | `shared` \| `private` | Copiato dal conto, vedi invarianti. |
| `ownerMemberId` | nullable | Copiato dal conto (denormalizzato per le regole Firestore). |
| `provenance` | `{ category, payee, split }` ognuno `manual` \| `rule` \| `import` \| `default` | Le regole riapplicate non toccano i campi `manual`. |
| `ruleIds` | string[] | Regole che hanno impostato qualcosa. |
| `importBatchId` | nullable | |
| `importFingerprints` | string[] (0..2) | Due quando un giroconto unisce le due righe importate dalle due banche. |
| `recurrenceId`, `recurrenceDueDate` | nullable | Collega il movimento reale alla scadenza che chiude. |
| audit | | `createdByMemberId` è l'autore. |

Tipi condivisi:
- `SplitSpec = { kind: "bp", shares: { [memberId]: Bp } }`, somma 10000 (per categorie e famiglia).
- `TransactionSplit = { kind: "bp" | "cents", source: "default" | "category" | "rule" | "manual", shares: { [memberId]: int } }`: `bp` somma 10000, `cents` somma `amountCents`. La quota in centesimi di ogni membro si calcola sempre con `allocateShares` (per `kind: "cents"` è il valore stesso). La divisione si salva al momento della scrittura (fotografia): cambiare la divisione della categoria vale solo per i movimenti nuovi o per una riapplicazione esplicita.

**rules** (`families/{f}/rules/{id}`)
- `name`, `enabled` (bool), `order` (int, più basso vince), `conditions` (tutte in AND): `types?: TransactionType[]`, `accountIds?: string[]`, `payeeIds?: string[]`, `description?: { op: "contains" | "startsWith" | "equals", value: string }` (confronto su testo normalizzato), `amountMinCents?`, `amountMaxCents?`; `actions`: `categoryId?`, `payeeId?`, `split?: SplitSpec`; audit.
- Semantica: regole abilitate in ordine `order`, poi `id`; per ogni campo d'azione vince la prima regola che lo imposta; un campo con provenienza `manual` non viene mai sovrascritto. Almeno una condizione e almeno un'azione.

**importProfiles** (`families/{f}/importProfiles/{id}`)
- `name`, `defaultAccountId` (nullable), `encoding` (`utf-8` | `windows-1252` | `iso-8859-1`), `delimiter` (`,` | `;` | `\t`), `quote` (default `"`), `skipRows` (int, default 0), `hasHeader` (bool), `headerSignature` (nullable: hash dell'intestazione normalizzata, per riconoscere il profilo da solo), `columns`: `{ date, description: ColRef[], amount?, debit?, credit?, payee?, type? }` con `ColRef = { header: string } | { index: int }`, `dateFormat` (pattern date-fns, per esempio `dd/MM/yyyy`), `decimalSeparator` (`,` | `.`), `thousandsSeparator` (`.` | `,` | ` ` | `''`), `sign`: `{ mode: "negativeIsExpense" | "positiveIsExpense" | "debitCreditColumns" | "typeColumn", expenseValues?: string[], incomeValues?: string[] }`, audit.

**importBatches** (`families/{f}/importBatches/{id}`)
- `profileId` (nullable), `accountId`, `fileName`, `fileHash` (SHA-256 del file), `rowCount`, `importedCount`, `duplicateCount`, `dateFrom`, `dateTo`, `importedAtMs`, audit. Scritto nello stesso `commit` dei movimenti.
- Impronta: `sha256(accountId | date | segno e importo in centesimi | normalize(description) | occorrenza)` troncato a 32 caratteri esadecimali, dove occorrenza è l'indice della riga tra le righe identiche dello stesso file. Calcolata in `core` con `@noble/hashes` (puro TypeScript, niente API del browser). Il controllo duplicati legge i movimenti del conto nell'intervallo `dateFrom..dateTo` (già necessari per l'anteprima) e confronta in locale.

**recurrences** (`families/{f}/recurrences/{id}`)
- `name`, `type`, `accountId`, `toAccountId` (nullable), `categoryId`, `payeeId` (nullable), `expectedAmountCents` (int > 0), `amountToleranceBp` (default 1000), `split` (`TransactionSplit`, nullable), `frequency`: `{ unit: "day" | "week" | "month" | "year", interval: int >= 1, dayOfMonth?: 1..31 }` (giorni oltre la fine del mese si fermano all'ultimo giorno), `startDate`, `endDate` (nullable), `matchWindowDays` (default 5), `descriptionMatch` (nullable, stessa forma della condizione delle regole), `skippedDates: string[]`, `archivedAtMs`, audit.
- Le scadenze e la "prossima scadenza" non si salvano: le calcola `core` da `frequency`, `startDate`, `skippedDates` e dai movimenti con `recurrenceId`. Una scadenza è chiusa quando un movimento ha `recurrenceDueDate` uguale.

**recurrenceDismissals** (`families/{f}/recurrenceDismissals/{key}`)
- I suggerimenti di ricorrenza si calcolano in `core` dallo storico; si salvano solo quelli scartati: `key` (hash di `payeeId` o descrizione normalizzata + conto + fascia d'importo), `dismissedAtMs`, `dismissedByMemberId`.

**memberSettings** (`families/{f}/memberSettings/{memberId}`): privato del membro.
- `notifications`: `{ recurringDue: { enabled, leadDays }, settlement: { enabled, thresholdCents }, importReminder: { enabled, everyDays } }`, `channels`: `{ inApp: bool, webPush: bool, email: bool, telegram: bool }`, `defaultView` (`family` | `personal`). I dettagli dei canali (sottoscrizioni push, chat Telegram) li fissa lo spec delle notifiche (feature 19), in collezioni proprie e private.

**reminders** (`families/{f}/reminders/{id}`)
- `memberId`, `kind` (`recurringDue` | `settlement` | `importReminder`), `refId` (nullable), `fireAtMs`, `title`, `body`, `status` (`pending` | `sent` | `dismissed`), `sentAtMs` (nullable), `dedupKey` (unico per famiglia: `kind|refId|data`), audit. Li calcola e salva il browser; il server li invia (feature 19).

### Relazioni

| Da | A | Cardinalità |
|---|---|---|
| families | members, accounts, categories, payees, transactions, rules, importProfiles, importBatches, recurrences, reminders | 1:N |
| users | members | 1:N (un utente, più famiglie; al massimo un membro per famiglia) |
| members | accounts (`ownerMemberId`) | 1:N, opzionale |
| accounts | transactions (`accountId`, `toAccountId`) | 1:N |
| categories | transactions, categories (`parentId`) | 1:N |
| payees | transactions | 1:N |
| transactions | members (quote in `split.shares`) | N:M |
| importBatches | transactions | 1:N |
| recurrences | transactions | 1:N |
| members | memberSettings | 1:1 |

### Firestore: layout, query e regole

Percorsi come sopra. Indici compositi (`firebase/firestore.indexes.json`) solo per `transactions`:
- `visibility ASC, date DESC`
- `visibility ASC, accountId ASC, date DESC`
- `ownerMemberId ASC, visibility ASC, date DESC`
- `visibility ASC, recurrenceId ASC, date DESC`
- `visibility ASC, importBatchId ASC`

Strategia letture (quota Spark 50.000 al giorno): cache persistente, si carica il periodo con un intervallo di `date`, e tutti gli altri filtri (tipo, categoria, destinatario, persona, testo) si applicano in `core` sui documenti già letti. Niente documenti riassuntivi finché un problema non è misurato. Il registro "tutto ciò che vedo" fa due query: `visibility == "shared"` e `ownerMemberId == me, visibility == "private"`.

Forma delle regole (`firebase/firestore.rules`):

```
function signedIn() { return request.auth != null; }
function acc(f) { return get(/databases/$(database)/documents/families/$(f)/access/$(request.auth.uid)).data; }
function isMember(f) { return signedIn() && exists(/databases/$(database)/documents/families/$(f)/access/$(request.auth.uid)); }
function isOwner(f) { return isMember(f) && acc(f).role == 'owner'; }
function me(f) { return acc(f).memberId; }
function stamped(f) { return request.resource.data.updatedByMemberId == me(f)
                      && (resource == null ? request.resource.data.createdByMemberId == me(f) : request.resource.data.createdByMemberId == resource.data.createdByMemberId); }
function cents(v) { return v is int; }

match /users/{uid} { allow read, write: if request.auth.uid == uid; }
match /inviteTokens/{token} { allow get: if signedIn(); allow create, delete: if isOwner(request.resource.data.familyId or resource.data.familyId);
                              allow update: if solo usedByUserId da null a request.auth.uid e non scaduto; }
match /families/{f} {
  allow read: if isMember(f);
  allow create: if request.resource.data.createdByUserId == request.auth.uid
                && getAfter(.../families/$(f)/access/$(request.auth.uid)).data.role == 'owner';
  allow update: if isOwner(f);
  match /access/{uid} {
    allow read: if isMember(f) || request.auth.uid == uid;
    allow create: if request.auth.uid == uid && (creatore della famiglia nello stesso batch
                 || invito valido: getAfter(inviteTokens/$(request.resource.data.inviteToken)).data.usedByUserId == uid);
    allow delete: if request.auth.uid == uid || isOwner(f);   // uscita; ultimo proprietario: controllato in core
  }
  match /members/{m} { allow read: if isMember(f); allow write: if isOwner(f) || (isMember(f) && m == me(f)); }
  match /memberSettings/{m} { allow read, write: if isMember(f) && m == me(f); }
  match /accounts/{a} {
    allow read: if isMember(f) && (resource.data.visibility == 'shared' || resource.data.ownerMemberId == me(f));
    allow write: if isMember(f) && stamped(f) && (visibility shared || ownerMemberId == me(f)) && campi ammessi;
  }
  match /transactions/{t} {
    allow read: if isMember(f) && (resource.data.visibility == 'shared' || resource.data.ownerMemberId == me(f));
    allow create, update: if isMember(f) && stamped(f) && request.resource.data.keys().hasOnly([...])
      && cents(request.resource.data.amountCents) && request.resource.data.amountCents > 0
      && request.resource.data.type in ['income','expense','transfer']
      && (request.resource.data.visibility == 'shared'
          || (request.resource.data.ownerMemberId == me(f) && request.resource.data.split.shares.keys().hasOnly([me(f)])))
      && (resource == null || resource.data.visibility == 'shared' || resource.data.ownerMemberId == me(f));
    allow delete: if isMember(f) && (resource.data.visibility == 'shared' || resource.data.ownerMemberId == me(f));
  }
  match /{coll}/{id} where coll in [categories, payees, rules, importProfiles, importBatches, recurrences, recurrenceDismissals]:
    allow read: if isMember(f); allow write: if isMember(f) && stamped(f) && campi ammessi e tipi;
  match /invites/{i} { allow read: if isMember(f); allow write: if isOwner(f); }
  match /reminders/{r} { allow read, write: if isMember(f) && resource/request.data.memberId == me(f); }
}
match /{path=**}/access/{uid} { allow read: if request.auth.uid == uid; }   // "le mie famiglie" via collectionGroup
```

Le regole non sommano le quote: la somma a 10000 o ad `amountCents` la garantisce solo `core` (accettato in spec 0001).

### Server: tabelle SQLAlchemy e migrazione Alembic

Una tabella per collezione, nomi in snake_case. Ogni tabella di famiglia ha `id` (`Uuid`, PK), `family_id` (FK `families.id`, `ON DELETE CASCADE`, indicizzata), le colonne di audit `BIGINT`, e:
- colonne vere per ciò che si interroga, si vincola o si referenzia: per `transactions` `type`, `date` (`TEXT` `YYYY-MM-DD`, CHECK sul formato), `amount_cents` (`BIGINT`, CHECK > 0), `is_refund`, `account_id`, `to_account_id`, `category_id`, `payee_id`, `payer_member_id`, `visibility`, `owner_member_id`, `import_batch_id`, `recurrence_id`, `recurrence_due_date` (FK verso le rispettive tabelle, `ON DELETE RESTRICT` per conti, categorie e destinatari: si archiviano, non si cancellano se usati);
- una colonna `JSON` per gli oggetti annidati (`split`, `settlement`, `provenance`, `rule_ids`, `conditions`, `actions`, `columns`, `sign`, `frequency`, `notifications`, ...), validata da Pydantic.
- Tabella figlia `transaction_fingerprints (family_id, fingerprint, transaction_id)` con `UNIQUE(family_id, fingerprint)`: è il vincolo che rende il doppione impossibile nel server (AC-6).
- Unicità: `members (family_id, user_id)` (parziale, `user_id` non nullo), `payees (family_id, normalized_name)`, `reminders (family_id, dedup_key)`, `users (email)`, `sessions (token_hash)`, `invites (token_hash)`.
- CHECK: `role IN (...)`, `visibility IN (...)`, `type IN (...)`, `(type = 'transfer') = (to_account_id IS NOT NULL)`, `visibility = 'shared' OR owner_member_id IS NOT NULL`.
- Indici: `transactions (family_id, visibility, date)`, `(family_id, account_id, date)`, `(family_id, owner_member_id, date)`, `(family_id, recurrence_id)`, `(family_id, import_batch_id)`.
- Una sola migrazione `0002_data_model` crea tutto; da lì in poi solo migrazioni additive.
- Isolamento: una dipendenza FastAPI comune ricava `userId` dalla sessione, carica il membro attivo di `family_id` (altrimenti `404`, per non rivelare l'esistenza della famiglia) e aggiunge sempre `family_id = :f` e il filtro di visibilità (`visibility = 'shared' OR owner_member_id = :me`) a ogni query su conti e movimenti.

### Contratto `DataAdapter` (cosa cambia in `packages/data`)

- `CollectionName` è l'unione chiusa delle collezioni di famiglia; ogni metodo valida i documenti con lo schema zod di `core` prima di scrivere e dopo aver letto.
- `Query` diventa: `where?: { [campo indicizzato]: valore }` (solo i campi dichiarati nel registro per quella collezione), `dateFrom?`, `dateTo?` (inclusivi, solo per collezioni con `date`), `orderBy?: "date_desc" | "order_asc" | "id_asc"`, `limit?` (max 500), `after?: { date?: string, id: string }` (cursore). `list` restituisce `{ docs, next: cursore | null }`. Una query non dichiarata è un errore di tipo, non un errore a runtime.
- Per `transactions` e `accounts` l'adapter aggiunge da solo il vincolo di visibilità (`scope: "shared" | "mine"`, default entrambi con due query unite e ordinate).
- Nuova `membership`: `myFamilies(): Promise<FamilySummary[]>`, `createFamily(family, ownerMember, defaults)` (atomico, include categorie iniziali), `createInvite(familyId, invite): Promise<{ token }>`, `acceptInvite(token, displayName): Promise<Result<FamilyId, "expired" | "used" | "revoked" | "not_found">>`, `leaveFamily(familyId): Promise<Result<void, "last_owner">>`, `claimMember(familyId, memberId)` (per l'import tra modalità).
- `commit` resta atomico; oltre 500 operazioni si spezza con `chunkOps` (in Firestore ogni blocco è atomico da solo: l'import scrive prima i movimenti e per ultimo il lotto, così un import interrotto si riconosce e si riprende con l'impronta).

### Formato di export (per la feature 23)

Un file JSON `noi2contiamo-export`:
`{ format: "noi2contiamo-export", version: 1, exportedAtMs, sourceBackend, family, users: [{ userId, email, displayName }], collections: { members: [...], accounts: [...], ..., reminders: [...] } }`. I documenti sono esattamente quelli del `DataAdapter` (stessi id UUIDv7, stessi nomi di campo). Esclusi: password, sessioni, token di invito, `access`. All'import gli id restano uguali; ogni `members.userId` diventa null e si ricollega quando l'utente con la stessa email accede e reclama il membro (`claimMember`). Export e import sono funzioni pure in `core` sopra i documenti; l'IO sta nell'adapter.

### API surface (server, sotto `/api/v1`, generata in OpenAPI)

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/families` | GET | | `FamilySummary[]` | sessione | 401 |
| `/families` | POST | family, ownerMember, defaults | familyId | sessione | 422 |
| `/families/{f}/{collection}` | GET | query whitelisted | `{ docs, next }` | membro | 404, 422 query non ammessa |
| `/families/{f}/{collection}/{id}` | GET | | doc | membro + visibilità | 404 |
| `/families/{f}/{collection}/{id}` | PUT | doc | | membro + visibilità | 409 impronta doppia, 422 |
| `/families/{f}/{collection}/{id}` | DELETE | | | membro + visibilità | 404, 409 in uso |
| `/families/{f}/commit` | POST | ops[] (max 500) | | membro | 409, 422 (tutto annullato) |
| `/families/{f}/invites` | POST | role, memberId? , expiresAtMs? | token | proprietario | 403 |
| `/invites/accept` | POST | token, displayName | familyId | sessione | 404, 410 scaduto/usato/revocato |
| `/families/{f}/leave` | POST | | | membro | 409 ultimo proprietario |
| `/families/{f}/members/{m}/claim` | POST | | | sessione, email uguale all'export | 403, 409 |
| `/families/{f}/export` | GET | | file export v1 | proprietario | 403 |

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Ogni scrittura | `id` | UUIDv7 generato dal client (`uuid` v7) |
| Ogni scrittura | `createdByMemberId`, `updatedByMemberId` | `access/{uid}.memberId` (Firebase) o membro dalla sessione (server) |
| Ogni scrittura | `createdAtMs`, `updatedAtMs` | orologio del client; il server lo sovrascrive con il suo |
| Nuovo movimento | `split` | regola vincente → `categories.defaultSplit` → `families.defaultSplit`; sorgente in `split.source` |
| Nuovo movimento | `payerMemberId`, `visibility`, `ownerMemberId` | dal conto (`accounts.ownerMemberId`, `accounts.visibility`) al momento della scrittura |
| Quote in centesimi | importo per membro | `allocateShares(amountCents, split)` in `core`, mai salvato per `kind: "bp"` |
| Saldo del conto | saldo | `initialBalanceCents` + somma movimenti, in `core` |
| Import | `importFingerprint` | `core`, da riga normalizzata + `accountId` + indice di occorrenza |
| Ricorrenza | prossima scadenza, previsione | `core` da `frequency`, `startDate`, `skippedDates`, movimenti collegati |
| Promemoria | `fireAtMs` | `core` da scadenza − `memberSettings.notifications.*.leadDays` |
| Valuta mostrata | simbolo e formato | `families.currency` + `Intl` `it-IT` |
| Data "oggi" | giorno di calendario | fuso del dispositivo dell'utente (`Intl`), solo per default e scadenze |

### Key invariants

- Ogni documento di famiglia appartiene a una sola famiglia, ricavata dal percorso (Firestore) o da `family_id` (SQL), mai dal corpo del documento.
- Importi interi in centesimi, `amountCents > 0`; il verso dipende da `type` e `isRefund`.
- Quote: somma esatta (10000 bp o `amountCents`), chiavi tutte membri della famiglia; `allocateShares` somma sempre ad `amountCents`.
- `transfer`: due conti diversi, nessuna categoria, nessuna `split`; `settlement` solo su `transfer` e con due membri diversi.
- Privato: `visibility: "private"` richiede conto privato dello stesso proprietario e quote al 100% su di lui; un giroconto è privato solo se entrambi i conti sono privati dello stesso membro. Cambiare la visibilità di un conto riscrive i suoi movimenti in un `commit`.
- Un membro attivo per utente per famiglia; almeno un proprietario attivo per famiglia.
- Riferimenti a conti, categorie, destinatari usati: si archiviano, non si cancellano.

### Security model

- Ruoli: `owner` gestisce famiglia, inviti, ruoli, rimozione membri ed export; `member` crea, modifica e cancella tutti i dati finanziari condivisi (fiducia di famiglia, accettata in spec 0001).
- Privato: conti e movimenti privati sono leggibili e scrivibili solo dal membro proprietario, in entrambi i backend; `memberSettings` e `reminders` solo dal membro a cui appartengono.
- Inviti: token segreto a 128 bit, uso singolo, scadenza 7 giorni, revocabile; nel server salvato solo come hash.
- Dati personali: email e nomi; nessun dato di pagamento. Niente password nell'export.

### Configuration required

Nessuna nuova variabile d'ambiente.

### Critical test scenarios

- Happy path: crea famiglia con proprietario, aggiungi conto, categoria con divisione 60/40, spesa di 100,01 €, leggi le quote 60,01/40,00 in centesimi, verifica **AC-1**, **AC-2**, **AC-3**, **AC-7**.
- Arrotondamento: 1 centesimo su tre membri a parti uguali e 10 centesimi su 3333/3333/3334, stesso risultato con chiavi in ordine diverso, verifica **AC-3**.
- Contract: ogni query ammessa e il cursore su `memory` e `http`, `commit` che fallisce a metà non scrive niente, verifica **AC-4**.
- Isolamento: utente di un'altra famiglia, e partner sul conto privato, ricevono rifiuto (`404` nel server, permesso negato in Firestore), verifica **AC-5**.
- Import: stesso CSV due volte, due righe identiche, seconda `PUT` con impronta uguale riceve `409`, verifica **AC-6**.
- Inviti: scaduto, usato, revocato rifiutati; ultimo proprietario non esce, verifica **AC-7**.
- Export: memory → export → nuovo memory, documenti uguali, `userId` null, verifica **AC-8**.

## Build plan

Ordine Tracer Bullet: prima un filo completo per le collezioni della slice 1 (famiglia, membri, accesso, conti, categorie, movimenti) attraverso `core`, `memory`, server e regole; poi si allarga alle altre collezioni con lo stesso schema.

1. `core`: tipi di base (`Id`, `MemberId`, `IsoDate`, `EpochMs`, `Bp`), `normalize`, registro delle collezioni e schemi zod per `families`, `members`, `accounts`, `categories`, `payees`, `transactions` con le invarianti, satisfies **AC-1**, **AC-2**
2. `core`: `allocateShares` e la risoluzione della divisione (regola, categoria, famiglia), con test, satisfies **AC-3**
3. `data`: `Query` tipizzata, `list` con cursore, vincolo di visibilità, API `membership`; `memory` aggiornato e contract suite estesa, satisfies **AC-4**, **AC-5**, **AC-7**
4. Server: migrazione `0002_data_model` (tutte le tabelle), modelli SQLAlchemy e Pydantic, dipendenza di famiglia, route generiche per collezione, `commit`, inviti e uscita; contract suite su `http`, satisfies **AC-4**, **AC-5**, **AC-7**
5. Firebase: regole e indici per le collezioni del filo, adapter aggiornato, test delle regole sull'emulatore (opzionali), satisfies **AC-5**, **AC-7**
6. Allargamento: schemi `core` e regole per `rules`, `importProfiles`, `importBatches`, `recurrences`, `recurrenceDismissals`, `memberSettings`, `reminders`, `invites`; impronta di import con `@noble/hashes` e tabella `transaction_fingerprints`, satisfies **AC-1**, **AC-4**, **AC-6**
7. `core`: export e import v1 come funzioni pure, test di andata e ritorno su `memory`, `claimMember`, satisfies **AC-8**

## Consequences

**Positive**:
- Un solo schema in `core` vale per tutti e due i backend; il `DataAdapter` resta piccolo.
- Le quote sono esatte e deterministiche; le divisioni passate non cambiano se cambia la categoria.
- Il `memberId` separato da `userId` rende possibile il partner senza account e lo spostamento tra modalità.
- Ogni slice successiva aggiunge solo campi o collezioni, niente migrazioni distruttive.

**Negative / tradeoffs**:
- `visibility` e `ownerMemberId` sono copiati sul movimento: cambiare la visibilità di un conto riscrive i suoi movimenti.
- La divisione salvata come fotografia è un valore "fissato": correggere una categoria richiede una riapplicazione esplicita.
- In Firestore la somma delle quote e l'ultimo proprietario li garantisce solo `core`; un client modificato potrebbe violarli.
- In Firestore un import oltre 500 righe non è atomico nel suo insieme (blocchi separati); l'impronta rende sicura la ripresa.
- Le colonne JSON nel server non hanno vincoli SQL sul loro contenuto: li garantisce Pydantic.
- Una sola valuta per famiglia, niente multi valuta.

**Neutral**:
- Nuova dipendenza `@noble/hashes` in `core`.
- Cancellare un movimento importato e reimportare lo stesso file lo ricrea (l'impronta sparisce con il movimento).

## Follow-up

- [ ] Feature 9 e 10: decidere se un giroconto tra conti di membri diversi senza `settlement` conta nel saldo tra membri (il modello regge entrambe le scelte).
- [ ] Feature 19: collezioni private per i canali (sottoscrizioni Web Push, chat Telegram, email) e ciclo di invio.
- [ ] Feature 23: comando di backup del file SQLite e interfaccia di export e import, sopra il formato v1 qui fissato.
- [ ] Documenti riassuntivi mensili in Firestore solo se le letture misurate si avvicinano alla quota.
