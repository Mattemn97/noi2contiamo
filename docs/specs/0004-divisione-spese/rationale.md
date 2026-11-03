# 0004. Divisione spese: decision record

## Context

Lo spec 0002 ha già fissato la forma delle quote (`SplitSpec` in punti base, `TransactionSplit` in punti base o centesimi, con `source`) e `allocateShares`. Mancavano le regole di risoluzione, il comportamento in modifica, la riapplicazione e l'interfaccia. Il feature 10 (saldo) e il feature 12 (regole) costruiscono sopra queste scelte, quindi devono restare stabili. Lavoro non interattivo: ogni scelta qui sotto è quella raccomandata, con il suo perché in una riga.

## Options considered

### Option 1: risoluzione in `core`, fotografia, riapplicazione dal client
Il client risolve con `core`, salva la divisione sul movimento, riscrive a richiesta.
**Pros**: un solo codice per i due backend; quote stabili. **Cons**: la riapplicazione legge e scrive dal client.

### Option 2: divisione calcolata alla lettura
Il movimento salva solo le eccezioni manuali, il resto si calcola leggendo la categoria corrente.
**Pros**: niente riapplicazione. **Cons**: cambiare una categoria riscrive il passato e il saldo tra membri; contraddice lo spec 0002.

### Option 3: riapplicazione nel server
**Cons**: Firebase sul piano Spark non ha funzioni server; servirebbe la logica due volte.

## Rationale

Scelte prese (raccomandate):
- Option 1: è l'unica che tiene la logica in `core` e funziona sul piano Spark.
- Percentuale in punti base o importi in centesimi: già nel modello 0002, niente decimali.
- Sottocategoria senza divisione eredita dalla principale: "Casa › Affitto" segue "Casa" senza doppio lavoro.
- Entrata su conto personale senza divisione di categoria va al proprietario: lo stipendio non è un'entrata comune da dividere 50/50.
- Privato sempre 100% proprietario: è già un'invariante del modello, il modulo la applica senza chiedere.
- Rimborsi con la stessa risoluzione del loro tipo: un rimborso della spesa comune si divide come la spesa.
- Modifica senza cambio di categoria o conto tiene la fotografia: coerente con lo spec 0002, niente cambi a sorpresa.
- Riapplica solo su `category` e `default`: le scelte manuali e delle regole sono intenzionali e non vanno perse.
- Divisione della famiglia modificabile da ogni membro attivo: come per le categorie, in una coppia nessuno è "secondo".
- Scorciatoie 50/50 e "Tutto a {nome}": coprono quasi tutti i casi di una coppia con un tocco.
- Un membro nuovo non entra da solo nella divisione della famiglia: cambiare quote in automatico sarebbe una sorpresa; lo si cambia in `/altro/famiglia`.

## References

Nessun riferimento esterno: decisione presa sullo spec 0002 e sul codice esistente.
