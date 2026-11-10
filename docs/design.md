# Design system di Noi2Contiamo

Fonte di verità per colori, tipografia, spaziature, componenti e grafici. Il codice la rispecchia in `apps/web/src/ui/tokens.css`: se cambi un valore qui, cambialo anche lì (un test confronta i due). Decisione e motivazioni: [spec 0003](specs/0003-design-system/index.md).

## Principi

- **Prima il telefono.** Ogni schermata si progetta a 360px di larghezza, poi si allarga.
- **I numeri prima di tutto.** Importi leggibili, allineati, con il segno sempre visibile. Il colore aiuta, non porta mai il significato da solo.
- **Calmo.** Superfici neutre, un solo colore d'accento, niente decorazioni. Il colore forte è riservato ai dati e agli stati.
- **Accessibile per costruzione.** WCAG 2.2 AA: contrasto, focus visibile, tastiera, lettore di schermo, bersagli grandi.
- **Un solo modo.** Ogni pagina usa i componenti di `apps/web/src/ui/`; niente colori, misure o font scritti a mano.

## Temi

- Default: segue il sistema (`prefers-color-scheme`).
- L'utente sceglie **Sistema · Chiaro · Scuro**; la scelta vale per il dispositivo (`localStorage`, chiave `n2c.theme`).
- Uno script in linea in `index.html` mette `data-theme="light"` o `"dark"` su `<html>` prima del primo disegno (niente lampo del tema sbagliato). Con "Sistema" l'attributo non c'è.
- I token scuri sono dichiarati due volte: sotto `@media (prefers-color-scheme: dark)` con la guardia `:root:not([data-theme="light"])`, e sotto `:root[data-theme="dark"]`.
- `<meta name="theme-color">` segue il tema attivo (`--color-page`).
- `color-scheme` impostato su `:root` così barre di scorrimento e controlli nativi seguono il tema.

## Colori dell'interfaccia

Contrasti calcolati sulla superficie indicata (WCAG 2.x). Testo normale serve almeno 4.5:1, bordi dei controlli e focus almeno 3:1.

| Token | Chiaro | Scuro | Uso | Contrasto (chiaro / scuro) |
|---|---|---|---|---|
| `--color-page` | `#f9f9f7` | `#0d0d0d` | sfondo della pagina | |
| `--color-surface` | `#fcfcfb` | `#1a1a19` | card, pannelli, grafici | |
| `--color-surface-raised` | `#ffffff` | `#232322` | dialoghi, menu, tooltip | |
| `--color-surface-sunken` | `#f0efec` | `#121211` | campi in sola lettura, righe alternate | |
| `--color-text` | `#0b0b0b` | `#f0efec` | testo principale | alto |
| `--color-text-secondary` | `#52514e` | `#c3c2b7` | etichette, testo di supporto | 7.73 / 9.72 |
| `--color-text-tertiary` | `#6f6e69` | `#8f8e88` | note, segnaposto, etichette degli assi | 4.98 / 5.30 |
| `--color-border` | `#e1e0d9` | `#2c2c2a` | separatori decorativi, griglie | decorativo |
| `--color-border-strong` | `#8f8e88` | `#8f8e88` | bordi di campi e controlli | 3.20 / 5.30 |
| `--color-accent` | `#1f6f5c` | `#5cc2a6` | bottone primario, link, selezione | 5.87 / 8.06 |
| `--color-accent-hover` | `#185a4b` | `#7fd3bb` | hover e pressione dell'accento | |
| `--color-on-accent` | `#ffffff` | `#0b0b0b` | testo sopra l'accento | 6.02 / 9.11 |
| `--color-accent-subtle` | `#e3f1ec` | `#15312a` | sfondo di elementi selezionati | |
| `--color-focus` | `#1f6f5c` | `#5cc2a6` | anello di focus | 5.87 / 8.06 |
| `--color-danger-text` | `#b42318` | `#f97066` | errori, azioni distruttive | 6.40 / 6.25 |
| `--color-danger` | `#b42318` | `#f97066` | sfondo bottone "Elimina" (testo `--color-on-danger`: `#ffffff` / `#0b0b0b`) | 6.57 |
| `--color-success-text` | `#006300` | `#0ca30c` | entrate, variazioni positive | 7.35 / 5.19 |
| `--color-warning-text` | `#8a5a00` | `#fab219` | avvisi | 5.77 / 9.49 |

Regole:
- Il testo usa solo `--color-text*`, `--color-accent`, `--color-on-*` e i tre `*-text` di stato. Mai un colore di serie dei grafici.
- Gli importi sono in `--color-text`. Le entrate hanno il segno `+` e `--color-success-text`; le uscite il segno `−` e il colore normale (il rosso ovunque mette ansia e non aggiunge informazione). Un saldo negativo da pareggiare usa `--color-danger-text` con icona.
- Nessun colore come unica informazione: c'è sempre segno, icona o testo.

### Colori di stato (fissi, mai tematizzati)

Per indicatori di stato (pallino, icona, barra di avanzamento di un budget), sempre con icona ed etichetta. Mai usati come colore di una serie.

| Token | Valore | Significato |
|---|---|---|
| `--status-good` | `#0ca30c` | a posto, in pari |
| `--status-warning` | `#fab219` | attenzione, scadenza vicina |
| `--status-serious` | `#ec835a` | sopra soglia |
| `--status-critical` | `#d03b3b` | scaduto, errore |

## Tipografia

- Font: quello di sistema, nessun file da scaricare: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Nessun font serif o decorativo.
- `font-variant-numeric: tabular-nums` su colonne di tabelle, tick degli assi e campi importo; i numeri grandi isolati (indicatori) restano proporzionali.
- Base 16px (`1rem`). I campi di input non scendono mai sotto `1rem` (su iOS un font più piccolo fa zoomare la pagina).
- Il testo si ingrandisce con le impostazioni del browser: misure in `rem`, mai `px` per i font.

| Token | Dimensione / interlinea | Uso |
|---|---|---|
| `--text-xs` | 0.75rem / 1rem | note sotto i campi, tick degli assi |
| `--text-sm` | 0.875rem / 1.25rem | etichette, celle di tabella dense |
| `--text-md` | 1rem / 1.5rem | testo normale, campi |
| `--text-lg` | 1.125rem / 1.75rem | titoli di card e grafici |
| `--text-xl` | 1.25rem / 1.75rem | titolo di sezione |
| `--text-2xl` | 1.5rem / 2rem | titolo di pagina |
| `--text-3xl` | 1.875rem / 2.25rem | valore di un indicatore (stat tile) |

Pesi: `--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600. Niente bold 700.

## Spaziature, raggi, ombre, movimento

- Spaziature su base 4px: `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem, `--space-5` 1.25rem, `--space-6` 1.5rem, `--space-8` 2rem, `--space-10` 2.5rem, `--space-12` 3rem, `--space-16` 4rem.
- Margine laterale della pagina: `--space-4` sul telefono, `--space-6` da `48rem`.
- Raggi: `--radius-sm` 4px (badge), `--radius-md` 8px (campi, bottoni), `--radius-lg` 12px (card, dialoghi), `--radius-full` 999px (chip, pillole).
- Ombre solo per elementi sopra la pagina: `--shadow-1` (menu, tooltip), `--shadow-2` (dialoghi). In tema scuro le ombre diventano un bordo `--color-border` più `--color-surface-raised`.
- Movimento: `--duration-fast` 120ms, `--duration-base` 200ms, `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)`. Con `prefers-reduced-motion: reduce` tutte le durate vanno a 0.01ms e le animazioni dei grafici sono spente.
- Livelli (`z-index`): `--z-nav` 10, `--z-overlay` 100, `--z-toast` 200.

## Layout

- Punti di rottura (min width, in `rem` così seguono lo zoom): `--bp-sm` 40rem, `--bp-md` 48rem, `--bp-lg` 64rem, `--bp-xl` 80rem. Nelle CSS Modules si scrivono come valori letterali dentro `@media (min-width: 48rem)` (le custom properties non funzionano nelle media query); la tabella qui è la fonte.
- Contenuto: larghezza massima 72rem, centrato.
- Sotto `64rem`: barra di navigazione in basso, fissa, con 5 voci (Panoramica, Movimenti, Aggiungi al centro come azione principale, Personale, Menu), rispetto di `env(safe-area-inset-bottom)`. "Menu" apre un pannello laterale da sinistra con tutte le sezioni.
- Da `64rem`: barra laterale con "Aggiungi" in cima e le sezioni Principale, Import e automazioni, Gestione (con Impostazioni); "Altro" non esiste più, `/altro` rimanda a `/impostazioni`.
- Dialoghi: sotto `48rem` diventano un foglio che sale dal basso a tutta larghezza; sopra, finestra centrata larga al massimo 32rem.
- Dashboard: una colonna sul telefono, due da `48rem`, tre da `80rem`. Ogni grafico occupa una card.
- Nessuno scorrimento orizzontale della pagina a 320px; le tabelle larghe scorrono dentro il loro contenitore con la prima colonna fissa.

## Accessibilità (WCAG 2.2 AA)

- Focus sempre visibile: anello 2px `--color-focus` con 2px di distanza (`outline`, mai rimosso), e mai coperto dalla barra fissa (`scroll-padding-bottom` pari all'altezza della barra).
- Bersagli: almeno 44x44px per controlli principali e voci della navigazione; mai sotto 24x24px.
- Ogni campo ha un'etichetta visibile; errori sotto il campo, collegati con `aria-describedby`, annunciati.
- Lingua `it` sul documento; ogni testo dal catalogo `apps/web/src/i18n/it.ts`.
- `forced-colors: active` (contrasto elevato di Windows): bordi e focus restano visibili, i grafici usano il riempimento a righe.
- Ogni grafico ha un'alternativa testuale: un titolo, un riassunto per i lettori di schermo e la tabella con gli stessi dati.

## Componenti

Tutti in `apps/web/src/ui/`, una cartella per componente (`Button/Button.tsx` + `Button.module.css` + test). Quelli interattivi stanno sopra `react-aria-components` (comportamento, tastiera e ARIA già corretti), lo stile è nostro.

| Componente | Base | Note |
|---|---|---|
| `AppShell` | nostro | navigazione in basso o laterale, area contenuto, salto al contenuto |
| `PageHeader` | nostro | titolo, sottotitolo, azioni |
| `Button` | RAC `Button` | varianti `primary`, `secondary`, `ghost`, `danger`; dimensioni `md` (44px) e `sm` (32px, solo in tabelle) |
| `IconButton` | RAC `Button` | etichetta obbligatoria (`aria-label` dal catalogo) |
| `Link` | RAC `Link` | |
| `TextField`, `SearchField` | RAC | |
| `MoneyField` | RAC `NumberField` | l'utente scrive euro con la virgola, il componente consegna `Cents` interi; `inputMode="decimal"` |
| `PercentField` | RAC `NumberField` | consegna punti base (10000 = 100%) |
| `Select`, `ComboBox` | RAC | `ComboBox` per categorie e destinatari (liste lunghe, ricerca) |
| `DatePicker`, `DateRangePicker` | RAC | locale `it-IT`, settimana da lunedì; il selettore di periodo ha scorciatoie (questo mese, mese scorso, ultimi 30 giorni, quest'anno, personalizzato) |
| `Checkbox`, `Switch`, `RadioGroup` | RAC | |
| `SegmentedControl` | RAC `ToggleButtonGroup` | settimana, mese, anno; vista coppia o personale |
| `Tabs` | RAC | |
| `Menu` | RAC `MenuTrigger` | azioni di riga |
| `Dialog`, `Sheet`, `ConfirmDialog` | RAC `Modal` + `Dialog` | `Sheet` è la variante dal basso; `ConfirmDialog` per cancellazioni |
| `Tooltip` | RAC | solo per spiegare, mai per informazioni indispensabili |
| `Toast` | nostro | regione `aria-live="polite"`, sparisce dopo 5 secondi, azione "Annulla" opzionale |
| `Card` | nostro | |
| `StatTile` | nostro | etichetta, valore grande, variazione con segno e freccia |
| `Amount` | nostro | formatta `Cents` con `Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" })`, segno esplicito, `tabular-nums` |
| `StatusBadge` | nostro | colore di stato + icona + etichetta |
| `Chip`, `FilterBar` | nostro + RAC `TagGroup` | filtri attivi rimovibili, "Azzera filtri" |
| `DataTable` | TanStack Table + `<table>` nativo | vedi Tabelle |
| `EmptyState`, `ErrorState`, `Skeleton` | nostro | ogni lista e ogni grafico ha i tre stati |
| `ThemeSwitcher` | `SegmentedControl` | Sistema, Chiaro, Scuro |

Icone: `lucide-react`, tratto 1.75, 20px nei controlli, 16px nel testo. Decorative con `aria-hidden`; da sole dentro un bottone serve l'etichetta.

## Tabelle

- `DataTable` usa `@tanstack/react-table` per lo stato (ordinamento, filtri, raggruppamento, totali) e disegna un `<table>` HTML vero con `<caption>`, `<th scope>` e `aria-sort`.
- Importi allineati a destra, `tabular-nums`; testo a sinistra.
- Riga dei totali in `<tfoot>`, peso `semibold`.
- Sotto `48rem` il registro movimenti mostra righe a due livelli (descrizione e importo sopra, data e categoria sotto) invece di colonne; le tabelle riassuntive restano tabelle con scorrimento interno e prima colonna fissa.
- Niente virtualizzazione: le liste si filtrano per periodo e si paginano a 50 righe.

## Grafici

Libreria: Recharts (SVG). Ogni grafico passa da `ChartFrame` in `apps/web/src/ui/charts/`, che impone le regole sotto. I colori arrivano come `var(--series-N)`, così il tema cambia senza ridisegnare.

### Palette categoriale (8 posizioni, ordine fisso)

| Slot | Tinta | Chiaro | Scuro |
|---|---|---|---|
| `--series-1` | blu | `#2a78d6` | `#3987e5` |
| `--series-2` | arancione | `#eb6834` | `#d95926` |
| `--series-3` | acqua | `#1baf7a` | `#199e70` |
| `--series-4` | giallo | `#eda100` | `#c98500` |
| `--series-5` | magenta | `#e87ba4` | `#d55181` |
| `--series-6` | verde | `#008300` | `#008300` |
| `--series-7` | viola | `#6250d6` | `#9085e9` |
| `--series-8` | rosso | `#e34948` | `#e66767` |

L'ordine è il meccanismo che rende la palette leggibile ai daltonici (validata sulle coppie adiacenti in entrambi i temi): si assegnano gli slot in ordine, mai a caso.

- Barre, linee, aree impilate: fino a 8 serie; oltre, le più piccole si uniscono in "Altro" (`--chart-other`, grigio).
- Grafici dove ogni colore può stare accanto a ogni altro (dispersione, piccoli multipli): massimo 3 serie (slot 1, 2, 3).
- In chiaro gli slot 3, 4 e 5 sono sotto 3:1 sulla superficie: dove compaiono servono etichette dirette o la tabella visibile.
- Ai membri della famiglia si assegna uno slot stabile in ordine di ingresso (`joinedAt`): lo stesso membro ha sempre lo stesso colore in tutti i grafici.
- Il colore codifica solo una dimensione che non è già sull'asse: le spese per categoria sono barre orizzontali ordinate, tutte in `--series-1`.

### Sequenziale e divergente

- Sequenziale blu (intensità, es. calendario delle spese): `--seq-100` `#cde2fb`, `--seq-150` `#b7d3f6`, `--seq-200` `#9ec5f4`, `--seq-250` `#86b6ef`, `--seq-300` `#6da7ec`, `--seq-350` `#5598e7`, `--seq-400` `#3987e5`, `--seq-450` `#2a78d6`, `--seq-500` `#256abf`, `--seq-550` `#1c5cab`, `--seq-600` `#184f95`, `--seq-650` `#104281`, `--seq-700` `#0d366b`. Per gradini ordinati (non continui) parti da 250 in chiaro e non oltre 600 in scuro.
- Divergente blu e rosso (variazione rispetto a un periodo: sotto e sopra): estremi `--series-1` e `--series-8` del tema, centro grigio `--div-mid` (`#f0efec` chiaro, `#383835` scuro), stesso numero di gradini per lato, interpolati in OKLCH tra estremo e centro. Blu = spesi meno, rosso = spesi di più.

### Cornice e inchiostro dei grafici

| Token | Chiaro | Scuro |
|---|---|---|
| `--chart-surface` | `#fcfcfb` | `#1a1a19` |
| `--chart-grid` | `#e1e0d9` | `#2c2c2a` |
| `--chart-axis` | `#c3c2b7` | `#383835` |
| `--chart-label` | `#6f6e69` | `#8f8e88` |
| `--chart-compare` | `#898781` | `#898781` |
| `--chart-other` | `#b5b4ad` | `#5c5b57` |

`--chart-label` è più scuro del grigio del riferimento (`#898781`, 3.5:1) perché le etichette degli assi sono testo e devono arrivare a 4.5:1.

### Regole (le impone `ChartFrame`)

1. **Un solo asse verticale.** Mai due scale sullo stesso grafico; due grandezze diverse vanno in due grafici.
2. **Legenda quando le serie sono 2 o più**, sopra il grafico, con quadratino colorato e nome in `--color-text-secondary`. Una serie sola: niente legenda, il titolo basta.
3. **Il testo non è mai nel colore della serie**: etichette, valori, tooltip e legenda usano l'inchiostro; il colore sta solo nel segno grafico e nel quadratino.
4. **I colori di stato sono riservati agli stati**, mai a una serie.
5. **Confronto tra periodi**: il periodo corrente in `--series-1`, quello di confronto in `--chart-compare` (linea tratteggiata o barra più chiara), entrambi in legenda con il nome del periodo ("Novembre 2026", "Ottobre 2026"). La differenza si legge nella tabella, con segno e percentuale.
6. **Asse delle quantità da zero** per barre e aree; le linee possono non partire da zero ma lo dicono nel tick.
7. **Tooltip**: superficie `--color-surface-raised`, testo inchiostro, importi formattati `it-IT`, attivabile da tastiera (`accessibilityLayer` di Recharts, attivo di default).
8. **Ogni grafico ha la sua tabella** con gli stessi dati, apribile con "Mostra tabella" (e sempre presente per i lettori di schermo), più un riassunto in `aria-label` sul contenitore (`role="img"`).
9. **Niente torte e ciambelle**: per le parti di un totale usa barre orizzontali ordinate o una barra impilata singola.
10. **Stati**: caricamento (scheletro della stessa forma), vuoto ("Nessun movimento in questo periodo"), errore con "Riprova".
11. **Movimento**: animazione di entrata breve, spenta con `prefers-reduced-motion`.
12. **Accessibilità extra**: con `forced-colors` o la stampa, le aree e le barre usano il riempimento a righe a 45° e 135°, mai attivo di default.
