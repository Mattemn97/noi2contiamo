# 0006. Import CSV: rationale

## Context

Le banche italiane e i servizi di pagamento esportano CSV molto diversi: codifica Windows-1252 o UTF-8 con BOM, punto e virgola o virgola, righe di intestazione del conto prima della tabella, date `gg/mm/aaaa`, importi con la virgola e il punto delle migliaia, a volte una colonna sola con il segno, a volte due colonne Dare e Avere, a volte una colonna "tipo". Il prototipo PHP aveva solo un import finto.

L'app gira con due backend (Firebase sul piano gratuito e il server Python) e la logica di dominio deve stare in `packages/core`. Lo spec 0002 aveva già fissato `importProfiles`, `importBatches` e l'impronta delle righe; lo spec 0005 aveva preparato `findTransferPairs` per l'import. Restava da decidere dove si legge il file, come si riconosce un profilo, come si evitano i doppioni e come si annulla.

## Options considered

### Option 1: lettura nel browser con `core`, scrittura con `commit`

Il file non lascia il dispositivo; `core` lo decodifica, lo legge e prepara i documenti; l'adapter li scrive.

**Pros**: stesso codice per Firebase e server; nessuna route nuova; test puri sulle fixture; privacy (il CSV grezzo non viene salvato).
**Cons**: il file sta in memoria; in Firestore oltre 500 operazioni il commit non è atomico.

### Option 2: upload al server Python che legge il CSV

**Pros**: file grandi, atomicità SQL.
**Cons**: non esiste in modalità Firebase (niente funzioni sul piano Spark); logica duplicata in Python, contro la regola "dominio in core".

### Option 3: libreria CSV esterna (Papa Parse) nel web

**Pros**: parser maturo, rilevamento del separatore.
**Cons**: non può stare in `core` (pacchetti ammessi limitati); la parte difficile (date, importi, segni, profili) resta da scrivere comunque; il parser RFC 4180 sono poche decine di righe.

## Rationale

Scelte prese senza domande, con l'opzione raccomandata e il perché in una riga:

- Lettura in `core` nel browser: è l'unico posto che vale per tutti e due i backend.
- Decoder UTF-8 e Windows-1252 scritti a mano: `core` non usa API del browser e Windows-1252 copre ISO-8859-1 per i caratteri stampabili.
- Rilevamento: BOM, poi UTF-8 valido, altrimenti Windows-1252: un file italiano non UTF-8 è quasi sempre Windows-1252.
- Separatore più costante, a pari merito `;`: le banche italiane usano `;` perché la virgola è il decimale.
- Intestazione cercata da sola (riga seguita da una data): Intesa e altre banche mettono righe del conto prima della tabella.
- Date con un piccolo parser a token, formati italiani prima: `date-fns` non è tra le dipendenze di `core` e servono pochi formati.
- Importi convertiti come stringa in centesimi: mai decimali, regola del progetto.
- Firma del profilo = hash dell'intestazione normalizzata: riconosce la banca senza dipendere dal nome del file.
- Abbinamento del profilo con i suoi stessi parametri (codifica, separatore, righe da saltare): due banche possono avere intestazioni simili ma preamboli diversi.
- Doppioni con le impronte dello spec 0002 su tutti i movimenti del periodo: l'impronta contiene già il conto e copre anche i giroconti uniti (che hanno l'impronta del conto di arrivo).
- Righe identiche nello stesso file restano due movimenti (indice di occorrenza): due caffè uguali nello stesso giorno sono veri.
- Lotto scritto prima dei movimenti: nel server c'è la chiave esterna `import_batch_id`; in Firestore un import interrotto si riconosce comunque.
- Annullamento = togli i movimenti del lotto e poi il lotto: semplice e reversibile con un reimport.
- Giroconto unito sul movimento esistente (stesso id): l'annullamento non deve far sparire un movimento che c'era prima dell'import.
- Giroconti proposti già scelti: è il caso comune (bonifico tra i propri conti) e l'utente li vede uno per uno in anteprima.
- Hook puro per le regole: il feature 12 si aggancia senza cambiare piano e interfaccia.
- Categoria vuota all'import: senza regole non c'è un modo affidabile di indovinarla; la divisione viene dalla famiglia o dal proprietario.
- Limite 5 MB / 5000 righe: tiene la memoria e il numero di commit ragionevoli su un telefono.
- Unicità delle impronte in Firestore controllata dall'adapter: una regola non può leggere le altre righe; il rischio (due import contemporanei) è accettabile per una famiglia.

## References

Nessun riferimento esterno: le scelte vengono dagli spec 0002 e 0005 e dai formati tipici dei file delle banche, riprodotti nelle fixture sintetiche in `packages/core/src/import/fixtures/`.
