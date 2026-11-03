# 0007. Regole automatiche: rationale

## Context

Lo spec 0002 aveva già fissato la collezione `rules` (condizioni in AND, azioni categoria, destinatario e divisione, "per ogni campo vince la prima") e sui movimenti `provenance` e `ruleIds`. Lo spec 0004 ha messo la regola nella precedenza della divisione (manuale > regola > categoria > famiglia); lo spec 0006 ha lasciato in `planImport` l'aggancio `hook` per le regole. Mancava il motore, l'interfaccia e il modo di applicare le regole ai movimenti già salvati senza rovinare le correzioni fatte a mano.

Le descrizioni delle banche sono rumorose ("PAGAMENTO POS ESSELUNGA 1234 MILANO"): serve un modo semplice e sicuro per riconoscerle e un modo per ricavarne un destinatario pulito. L'app gira con due backend e la logica deve stare in `core`; Firebase sul piano gratuito non ha funzioni lato server.

## Options considered

### Option 1: motore puro in `core`, prima regola vince per campo (scelta)

**Pros**: stesso codice nei due backend e in tutti i percorsi; test puri; prevedibile (l'ordine della lista dice chi vince); compatibile con lo spec 0002.
**Cons**: l'applicazione ai vecchi gira nel client e legge tutti i movimenti visibili.

### Option 2: la prima regola che corrisponde vince tutto (e si ferma)

**Pros**: ancora più semplice da spiegare.
**Cons**: una regola "Esselunga → destinatario" impedirebbe a una regola generica "conto comune → divisione 50/50" di agire; servirebbero regole che ripetono le stesse azioni.

### Option 3: motore nel server Python

**Pros**: applicazione ai vecchi atomica in SQL.
**Cons**: non esiste in modalità Firebase; logica duplicata, contro "dominio in core".

## Rationale

Scelte prese senza domande (modalità non interattiva), con l'opzione raccomandata e il perché in una riga:

- Semantica per campo, prima vince (non "prima vince tutto"): già nello spec 0002, permette regole piccole che si combinano.
- Condizioni sui valori originali, niente concatenazione: risultato indipendente dall'ordine delle azioni e facile da prevedere.
- `match: all | any` dentro `conditions`: nessuna chiave nuova in Firestore né colonna nel server.
- Descrizione con `pattern` a caratteri jolly invece di regex: niente ReDoS e niente sintassi da imparare; `contains` resta il caso comune.
- Testo normalizzato da tutte e due le parti: accenti e maiuscole delle banche non contano.
- Condizione membro su `payerMemberId`: è il "chi" che il registro già usa (feature 8).
- Conto: origine o arrivo per i giroconti, come il filtro conto del registro.
- Azione giroconto come `transferAccountId` (conto controparte): il verso si ricava dal tipo, la regola resta una sola per i due sensi.
- Candidato ricorrente derivato da `ruleIds` invece di un campo nuovo: niente migrazione, niente valore salvato che può invecchiare.
- Azioni non applicabili saltate in silenzio: una regola vecchia (categoria archiviata) non deve bloccare l'import.
- Manuale mai sovrascritto, `import` sì: il destinatario grezzo del file è proprio quello che la normalizzazione vuole sostituire.
- Applica ai vecchi senza annullare i campi `rule` orfani: nessuna modifica a sorpresa; l'anteprima mostra sempre cosa cambia.
- Giroconto sui vecchi solo se nessun campo è manuale: cambiare tipo a un movimento corretto a mano sarebbe distruttivo.
- Suggerimento nel modulo solo sui campi non toccati e solo per i movimenti nuovi: l'utente resta padrone di quello che scrive.
- Riordino con trascinamento più pulsanti Su e Giù: il trascinamento da solo non è accessibile da tastiera (WCAG AA).
- Anteprima dell'editor sugli ultimi 12 mesi, prime 50 righe: risposta immediata anche con molti movimenti; "Applica" invece legge tutto.
- Riferimenti controllati nel server (422) e tollerati nel motore: Firestore non può controllarli con le sue regole.
- Destinatario dalla descrizione con lista di parole bancarie e stop alla prima cifra: copre i formati POS e SDD italiani senza dizionari di città.
- Nessun cross check con un altro modello: scelta del flusso (Workflow Beta senza review di altri modelli).
