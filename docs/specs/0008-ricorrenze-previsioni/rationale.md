# 0008. Ricorrenze e previsioni: rationale

## Context

Il feature 13 chiede ricorrenze con scadenze, riconoscimento dallo storico, previsione del saldo e chiusura della scadenza da un pagamento reale. Lo spec 0002 ha già fissato le collezioni `recurrences` e `recurrenceDismissals` e il collegamento sul movimento (`recurrenceId`, `recurrenceDueDate`), con la scelta "scadenze calcolate, non salvate". Lo spec 0007 segna i candidati con `actions.recurring` in `ruleIds`. Il progetto calcola tutto in `core` e i backend salvano soltanto.

Le scelte sono state prese senza domande, con l'opzione raccomandata e una riga di motivo per ognuna.

## Options considered

1. **Derivato in `core`, collegamento solo su conferma** (scelto): scadenze e abbinamenti calcolati, scrittura solo per Collega, Conferma, Registra, Salta.
2. **Scadenze salvate come documenti**: semplici da interrogare, ma vanno rigenerate a ogni modifica e sincronizzate nei due backend; contraddice lo spec 0002.
3. **Collegamento automatico a ogni import**: chiude le scadenze senza clic, ma scrive movimenti senza che l'utente lo veda e tocca il flusso di import già chiuso.

## Rationale

- **Option 1**: zero migrazioni e nessuna scrittura a sorpresa; l'abbinamento automatico si vede subito e si conferma con un clic.
- **`frequency.count` nel JSON**: la colonna è JSON e le regole Firestore controllano solo le chiavi di primo livello, quindi niente migrazione.
- **Fisso = tolleranza 0**: niente campo nuovo; il caso "variabile" usa la tolleranza già prevista.
- **Calcolo dall'inizio della serie (n × intervallo)**: evita che 31 → 28 febbraio faccia scivolare tutte le date dopo.
- **Ultimo giorno del mese quando manca il giorno**: è quello che fanno banche e contratti (e lo spec 0002).
- **Abbinamento greedy per data**: deterministico e spiegabile; i casi rari si correggono con Collega e Scollega.
- **Identità con destinatario, poi descrizione, poi categoria**: è l'ordine di affidabilità dei dati che abbiamo.
- **Suggerimenti con bande di frequenza e 75% di intervalli regolari**: tollera un pagamento spostato di qualche giorno senza proporre spese casuali.
- **Fasce di importo al 25%**: separa due abbonamenti dallo stesso destinatario (per esempio due piani Amazon).
- **Media variabile su 3 mesi interi**: abbastanza recente, abbastanza stabile; il mese corrente aggiunge solo quanto manca.
- **Famiglia = conti condivisi**: i conti privati restano nella vista per conto del proprietario, come nel resto dell'app.
- **Scadenze non pagate del passato non pesano sulla previsione**: si assume che siano saltate o già pagate in altro modo; la lista le mostra come "Non pagata".

## References

Nessun riferimento esterno: decisione presa sul codice e sugli spec 0002, 0004, 0005, 0007.
