# 0003. Design system: rationale

## Context

L'app è una SPA React 19 + Vite, installabile come PWA, usata soprattutto dal telefono, in italiano, con tema chiaro e scuro (spec 0001). Le slice successive portano molte schermate dello stesso tipo: dashboard con grafici e tabelle riassuntive, moduli per movimenti, conti e regole, tabelle con filtri, finestre modali. Senza una base comune ogni slice inventa stile e componenti, e l'aspetto diverge.

Forze in gioco. Il progetto è open source e self hosted: ogni dipendenza è un costo per chi installa e mantiene, quindi poche e solide. Lo spec 0001 vincola lo stile a CSS statico (nessun server di rendering). L'accessibilità WCAG 2.2 AA è un requisito, non un extra: tastiera, lettore di schermo, contrasto, bersagli grandi. I grafici devono essere dinamici (cambio di periodo, confronto, tooltip) e leggibili da chi è daltonico, in entrambi i temi. Gli importi sono `Cents` interi e vanno mostrati in formato italiano.

Lavora una persona con l'aiuto di agenti AI: le regole devono essere imposte da test e lint, non dalla memoria.

## Options considered

### Option 1: CSS Modules + token, React Aria Components, Recharts, TanStack Table

Stile scritto in CSS Modules (già supportati da Vite) che leggono custom properties; comportamenti accessibili da `react-aria-components` senza stile; grafici dichiarativi in SVG con Recharts; logica delle tabelle da TanStack Table, markup nostro.

**Pros**:
- Nessuna dipendenza per lo stile; il CSS è standard e leggibile da chiunque.
- React Aria copre tutti i componenti difficili (date picker, combobox, dialog, menu) con localizzazione `it-IT`.
- Recharts accetta variabili CSS come colori: tema e palette si gestiscono solo nei token.

**Cons**:
- Più file per componente; si scrive ogni stile.
- React Aria ha una curva di apprendimento e un bundle non piccolo se si importano molti componenti.

### Option 2: Tailwind CSS 4 + Radix Primitives + Recharts

Classi di utilità con i token nel tema di Tailwind, primitivi Radix senza stile.

**Pros**:
- Si scrive in fretta, molti esempi in giro (anche shadcn/ui come ispirazione).
- Radix è leggero e diffuso.

**Cons**:
- Un compilatore e un vocabolario in più per chi contribuisce.
- Radix non ha date picker né number field localizzato: servono altre librerie proprio per i campi più usati (date, importi).
- Le classi lunghe nel JSX rendono più difficile far rispettare "solo token".

### Option 3: libreria di componenti già stilizzata (Mantine o MUI)

Componenti completi con tema, grafici e tabelle della stessa famiglia.

**Pros**:
- Molto pronto subito, incluse tabelle e date.
- Un tema centrale.

**Cons**:
- Pesante e con un aspetto riconoscibile difficile da piegare alla palette validata.
- Stile in CSS in JS o in un sistema proprio: più runtime, più dipendenze, aggiornamenti maggiori frequenti.
- Accessibilità buona ma meno rigorosa di React Aria sui componenti complessi.

### Option 4: tutto fatto in casa

Componenti, grafici in SVG e tabelle scritti da zero.

**Pros**:
- Zero dipendenze, controllo totale.

**Cons**:
- Date picker, combobox e dialog accessibili sono mesi di lavoro e di bug sottili.
- Grafici con assi, tooltip e tastiera da reinventare.

## Rationale

Il vincolo più forte è l'accessibilità sui componenti difficili dei moduli contabili: date, periodi, importi, ricerca di categorie. React Aria è l'unica opzione senza stile che li copre tutti con il locale italiano e il comportamento corretto da tastiera e lettore di schermo; Radix (opzione 2) lascerebbe scoperti proprio date e importi. Una libreria già stilizzata (opzione 3) li coprirebbe, ma porta un aspetto, un runtime e un peso che vanno contro "poche dipendenze" e contro la palette dei grafici che vogliamo imporre.

Per lo stile, CSS Modules con custom properties è la scelta noiosa: è già in Vite, non aggiunge niente da installare o imparare, e il tema chiaro e scuro diventa un semplice cambio di variabili, valido anche dentro i grafici SVG. Tailwind sarebbe più rapido da scrivere ma aggiunge uno strumento e rende più difficile un controllo automatico "solo token".

Per i grafici Recharts è il compromesso giusto tra pronto e controllabile: tooltip, legenda, responsive e navigazione da tastiera inclusi, colori dai token, e lo si avvolge in `ChartFrame` per imporre le regole (un asse, legenda da 2 serie, testo in inchiostro, tabella sempre). visx darebbe più controllo ma molto più codice; ECharts disegna su canvas, meno adatto ai token CSS e alla stampa. Le tabelle sono il cuore dell'app (registro, riassunti per dimensione): TanStack Table dà ordinamento, filtri e totali senza imporre markup, così restano `<table>` vere e accessibili. Il font di sistema evita download e lampi di caricamento nella PWA e ha numeri tabulari su tutte le piattaforme.

La palette dei grafici è quella di riferimento della skill `dataviz` (8 slot in ordine validato per i daltonici, stati fissi, sequenziale blu, divergente blu e rosso). Un solo scostamento, voluto: il grigio delle etichette degli assi è più scuro (`#6f6e69` in chiaro, `#8f8e88` in scuro) perché quello di riferimento arriva solo a 3.5:1 e le etichette sono testo. I contrasti in `docs/design.md` sono stati calcolati con la formula WCAG il 2026-11-03.

### Scelte minori (prese con il quadro completo)

- Accento: verde petrolio `#1f6f5c` / `#5cc2a6`, già usato nello scaffold; 5.87:1 e 8.06:1 sulle superfici, con testo bianco sopra a 6.02:1. Runner up: blu, scartato perché coincide con la serie 1.
- Entrate in verde con `+`, uscite nel colore normale con `−`: il rosso su ogni spesa allarma senza informare. Runner up: rosso e verde ovunque.
- Preferenza del tema per dispositivo in `localStorage`, non nel profilo: è una comodità, non un dato da sincronizzare. Runner up: campo nel profilo utente.
- Navigazione in basso sotto `64rem`, laterale sopra: standard delle app da telefono. Runner up: menu a scomparsa, che nasconde le voci principali.
- Niente virtualizzazione delle tabelle: una famiglia ha centinaia di movimenti al mese, si pagina a 50. Runner up: `@tanstack/react-virtual`, da aggiungere solo se misurato lento.
- Niente torte e ciambelle: confrontare angoli è difficile, le barre ordinate si leggono meglio. Runner up: ciambella con al massimo 5 parti.
- Test axe con `axe-core` direttamente invece di `vitest-axe` (fermo alla 0.1.0). Runner up: Playwright con axe, più pesante.
- Nessuna ricerca di skill o server MCP per le nuove librerie: esecuzione non interattiva, scelta registrata; si può rifare con `/audit`.
