# 0003. Design system: token CSS, componenti React Aria, grafici Recharts

**Date**: 2026-11-03
**Status**: Accepted

## Summary

Questo spec fissa come appare e come si costruisce l'interfaccia di Noi2Contiamo. Lo stile vive in CSS Modules (file CSS legati a un solo componente) che leggono variabili CSS (token, cioè valori con un nome: colori, misure, font) definite una volta per il tema chiaro e scuro. I componenti interattivi stanno sopra `react-aria-components`, una libreria senza stile che dà tastiera e accessibilità già corrette; i grafici usano Recharts con la palette validata per i daltonici; le tabelle usano TanStack Table per la logica e HTML vero per il markup. I valori esatti stanno in [docs/design.md](../../design.md), che diventa la fonte di verità per ogni pagina.

## Requirements

**User stories**:
- Come membro della famiglia, voglio usare l'app dal telefono con il tema che preferisco, così da leggerla bene di giorno e di sera.
- Come persona daltonica o che usa un lettore di schermo, voglio grafici e tabelle che posso capire senza dipendere dal colore.
- Come sviluppatore, voglio componenti e token pronti, così ogni nuova pagina ha lo stesso aspetto senza inventare stili.

**Acceptance criteria**:
- **AC-1**: `docs/design.md` esiste e `apps/web/src/ui/tokens.css` contiene esattamente i token che elenca (nomi e valori chiaro e scuro); un test Vitest legge entrambi e fallisce se divergono.
- **AC-2**: al primo avvio il tema segue il sistema; il `ThemeSwitcher` (Sistema, Chiaro, Scuro) cambia il tema subito, la scelta sopravvive al ricaricamento sullo stesso dispositivo, e al caricamento non si vede mai il tema sbagliato; `<meta name="theme-color">` segue il tema attivo.
- **AC-3**: ogni coppia testo e sfondo dichiarata nei token arriva almeno a 4.5:1, e bordi dei controlli e focus almeno a 3:1, in entrambi i temi; lo verifica un test che calcola il contrasto dai token.
- **AC-4**: nessun colore scritto a mano (esadecimale, `rgb()`, `hsl()`, `oklch()`) in `apps/web/src/**/*.module.css` o `*.tsx` fuori da `ui/tokens.css`; un test che scansiona i sorgenti fallisce alla prima violazione.
- **AC-5**: i componenti dell'inventario in `docs/design.md` esistono in `apps/web/src/ui/`, si usano solo da tastiera (Tab, frecce, Invio, Esc), e la pagina catalogo `/dev/ui` (solo in sviluppo) non ha violazioni axe in tema chiaro e scuro.
- **AC-6**: a 360px di larghezza nessuna pagina scorre in orizzontale; i controlli principali e la navigazione misurano almeno 44x44px; sotto `64rem` la navigazione è in basso, da `64rem` è laterale; il focus non finisce mai sotto la barra fissa.
- **AC-7**: ogni grafico passa da `ChartFrame`, che: richiede un titolo e un riassunto testuale; mostra la legenda quando le serie sono 2 o più; ha un solo asse verticale; assegna i colori dagli slot `--series-1..8` in ordine; scrive ogni testo con i token di inchiostro; offre "Mostra tabella" con gli stessi dati; ha gli stati caricamento, vuoto ed errore.
- **AC-8**: `Amount` mostra `Cents` come euro `it-IT` (`1.234,56 €`) con segno esplicito; `MoneyField` accetta "12,5" e consegna `1250`, accetta "1.234,56" e consegna `123456`; date e mesi sono in italiano con settimana da lunedì.
- **AC-9**: la pagina attuale (`App.tsx`) gira dentro `AppShell` e usa solo componenti di `ui/`; il CSS provvisorio di `styles.css` è sostituito da `tokens.css` + `base.css`.
- **AC-10**: con `prefers-reduced-motion: reduce` non ci sono animazioni; con `forced-colors: active` focus, bordi e segni dei grafici restano visibili.

## Decision

**Chosen option**: Option 1: CSS Modules + token in custom properties, `react-aria-components` per i comportamenti, Recharts per i grafici, TanStack Table per le tabelle, `lucide-react` per le icone, font di sistema.

Tutto lo stile si scrive in CSS statico (nessuno stile generato a runtime), con un solo file di token per i due temi e componenti di `apps/web/src/ui/` come unico modo di costruire le pagine.

**Implementation skills**: nessuna skill di stack installata. La skill `dataviz` (inclusa in Claude Code) ha fornito la palette dei grafici e le regole; i valori sono copiati in `docs/design.md`, quindi `/develop` non ne dipende.

## Rationale

Ragionamento, contesto e opzioni scartate: vedi [rationale.md](rationale.md).

## Standard definition

### Librerie (versioni lette dal registro npm il 2026-11-03)

| Area | Scelta | Perché (runner up) |
|---|---|---|
| Stile | CSS Modules (già in Vite) + custom properties in `ui/tokens.css` | Zero dipendenze, zero runtime, il tema cambia solo variabili (runner up: Tailwind 4). |
| Componenti interattivi | `react-aria-components ~1.22.1` | Accessibilità di livello alto su tutto, inclusi date picker e combobox in `it-IT` (runner up: Radix Primitives, senza date picker). |
| Grafici | `recharts ~3.10.1` | Componenti React dichiarativi in SVG, tooltip e legenda pronti, accetta `var(--series-N)` come colore, tastiera inclusa (runner up: visx, più codice da scrivere). |
| Tabelle | `@tanstack/react-table ~9.3.1` | Ordinamento, filtri, raggruppamento e totali senza markup imposto (runner up: tabella fatta a mano). |
| Icone | `lucide-react ~1.67.0` | Licenza ISC, si importano solo le icone usate, stile sobrio (runner up: Phosphor). |
| Font | font di sistema, nessun pacchetto | Zero byte, ottimi numeri tabulari ovunque (runner up: Inter con `@fontsource-variable/inter 5.3`). |
| Lint accessibilità | `eslint-plugin-jsx-a11y ~6.10.2` | Blocca al commit gli errori più comuni (immagini senza testo, ruoli sbagliati). |
| Test accessibilità | `axe-core` 4.x in Vitest con `@testing-library/react` (già in 0001) | Controllo automatico sulla pagina catalogo, senza servizi esterni. |

Fissa la minor in `apps/web/package.json` (`~` come le altre dipendenze); il lockfile fissa il resto. Recharts e i grafici si caricano solo nelle pagine che li usano (`React.lazy`), così il registro non paga il loro peso.

### Struttura

```
apps/web/src/ui/
  tokens.css            # tutti i token, chiaro e scuro (rispecchia docs/design.md)
  base.css              # reset minimo, body, focus, reduced motion, forced colors
  theme.ts              # preferenza tema: leggi, salva, applica (data-theme)
  format.ts             # formatCents, formatDate, formatPeriod (Intl it-IT)
  Button/Button.tsx  Button/Button.module.css  Button/Button.test.tsx
  ...                   # un componente per cartella, export con nome da ui/index.ts
  charts/
    ChartFrame.tsx      # titolo, legenda, riassunto, tabella, stati
    seriesColor.ts      # slot in ordine, colore stabile per membro, "Altro"
    TrendChart.tsx  BarList.tsx  StackedBar.tsx  CompareChart.tsx
apps/web/src/dev/UiCatalog.tsx   # /dev/ui, solo con import.meta.env.DEV
```

`index.html` contiene uno script in linea di poche righe che legge `n2c.theme` da `localStorage` (dentro `try`, perché può fallire) e mette `data-theme` su `<html>` prima che parta React.

### Schema canonico

```tsx
// Button/Button.tsx: comportamento da react-aria-components, stile da CSS Module e token
import { Button as AriaButton, type ButtonProps } from "react-aria-components";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "primary", ...props }: ButtonProps & { readonly variant?: Variant }) {
  return <AriaButton {...props} className={styles.button} data-variant={variant} />;
}
```

```css
/* Button.module.css: solo token, stati dagli attributi data-* di React Aria */
.button {
  min-block-size: 2.75rem;
  padding-inline: var(--space-4);
  border-radius: var(--radius-md);
  font: var(--weight-medium) var(--text-md) / 1.5rem var(--font-sans);
}
.button[data-variant="primary"] { background: var(--color-accent); color: var(--color-on-accent); }
.button[data-hovered][data-variant="primary"] { background: var(--color-accent-hover); }
.button[data-focus-visible] { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.button[data-disabled] { opacity: 0.5; }
```

```tsx
// Un grafico: sempre dentro ChartFrame, colori per ruolo
<ChartFrame
  title={t("dashboard.trend.title")}
  summary={t("dashboard.trend.summary", { total })}
  series={[{ key: "uscite", label: t("series.expenses") }, { key: "entrate", label: t("series.income") }]}
  data={rows}
  table={{ columns, rows }}
  state={query.status}
>
  {(colors) => (
    <LineChart data={rows}>
      <Line dataKey="uscite" stroke={colors.uscite} />
      <Line dataKey="entrate" stroke={colors.entrate} />
    </LineChart>
  )}
</ChartFrame>
```

### Value sourcing

| Azione | Valore | Fonte |
|---|---|---|
| Applica tema | tema attivo | `localStorage` `n2c.theme` (`system`, `light`, `dark`), default `system` → `prefers-color-scheme` |
| `Amount` | testo dell'importo | `Cents` dal chiamante, `Intl.NumberFormat("it-IT", EUR)` |
| `MoneyField` | `Cents` consegnati | testo digitato in formato it-IT (virgola decimale, punto delle migliaia), convertito in centesimi interi senza virgola mobile |
| Date e periodi | testo e primo giorno della settimana | `Intl.DateTimeFormat("it-IT")`, `I18nProvider locale="it-IT"` di React Aria (lunedì) |
| Colore di una serie | `var(--series-N)` | posizione della serie nell'elenco passato a `ChartFrame`; per i membri, ordine di `joinedAt` (spec 0002) |
| Etichette di componenti | "Chiudi", "Mostra tabella", "Azzera filtri"... | `apps/web/src/i18n/it.ts` |
| Valori di token | colori, misure | `docs/design.md`, copiati in `ui/tokens.css` |

### Regole invarianti

- Le pagine importano solo da `ui/` (componenti) e mai direttamente da `react-aria-components` o `recharts`; i grafici solo da `ui/charts/`.
- Nessun colore, font o misura in `px` scritto a mano fuori da `tokens.css` (eccezioni: `0`, `1px` per i bordi, `100%`).
- Nessuno stile in linea (`style={{...}}`) tranne valori calcolati a runtime (larghezza di una barra di avanzamento).
- Testo mai nel colore di una serie; colori di stato mai su una serie; sempre un segno o un'icona oltre al colore.
- Ogni stringa visibile dal catalogo `it.ts`.

**Replaces**: `apps/web/src/styles.css` provvisorio (token `--bg`, `--fg`, `--muted`, `--accent` e la classe `.shell`) e il `theme-color` fisso in `index.html`.

**Enforcement**:
- Test Vitest `apps/web/src/ui/tokens.test.ts`: confronto token tra `docs/design.md` e `tokens.css` (AC-1), contrasto (AC-3), scansione dei colori scritti a mano (AC-4).
- ESLint: `eslint-plugin-jsx-a11y` (config `recommended`) e `no-restricted-imports` che vieta `react-aria-components` e `recharts` fuori da `apps/web/src/ui/`.
- Test axe sulla pagina catalogo nei due temi (AC-5).

**Rollout**: subito per tutto il codice nuovo; l'unica pagina esistente si migra in questo feature.

**Exceptions**: la pagina catalogo `/dev/ui` può importare direttamente le librerie per confronti; il prototipo PHP alla radice non è toccato.

## Build plan

Ordinato come Tracer Bullet: prima un filo che attraversa token, tema, un componente e la pagina vera, poi si allarga.

1. `tokens.css`, `base.css` e lo script del tema in `index.html`; `theme.ts` con `ThemeSwitcher` minimo; `tokens.test.ts` con i tre controlli, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**
2. Filo sottile: `AppShell` (navigazione in basso e laterale), `PageHeader`, `Button`, `Card`, `Amount` e `format.ts`; `App.tsx` migrata dentro `AppShell`, `styles.css` rimosso, satisfies **AC-6**, **AC-8**, **AC-9**
3. Campi e moduli: `TextField`, `SearchField`, `MoneyField`, `PercentField`, `Select`, `ComboBox`, `DatePicker`, `DateRangePicker` con scorciatoie, `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl` (con `I18nProvider it-IT`), satisfies **AC-5**, **AC-8**
4. Sovrapposizioni e messaggi: `Dialog`, `Sheet`, `ConfirmDialog`, `Menu`, `Tooltip`, `Toast`, `Tabs`, `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton`, satisfies **AC-5**, **AC-10**
5. Tabelle: `DataTable` su TanStack Table con totali in `<tfoot>`, scorrimento interno e prima colonna fissa, `Chip` e `FilterBar`, satisfies **AC-5**, **AC-6**, **AC-8**
6. Grafici: `seriesColor.ts`, `ChartFrame`, `TrendChart`, `BarList`, `StackedBar`, `CompareChart`, caricati con `React.lazy`; dati di esempio nel catalogo, satisfies **AC-7**, **AC-10**
7. Pagina catalogo `/dev/ui` con ogni componente nei due temi, test axe, `eslint-plugin-jsx-a11y` e `no-restricted-imports` in `eslint.config.js`, satisfies **AC-5**, **AC-10**

## Consequences

**Positive**:
- Ogni pagina delle slice successive si compone da pezzi pronti e accessibili; `/develop` non deve inventare stili.
- Il tema cambia solo variabili CSS: nessun nuovo render React, grafici compresi.
- Nessun servizio esterno, nessun font da scaricare: funziona offline come PWA e in tutte e tre le modalità di installazione.
- Le regole dei grafici sono imposte dal codice (`ChartFrame`), non solo scritte.

**Negative / tradeoffs**:
- `react-aria-components` va imparato (stati come attributi `data-*`, render props); è più verboso di una libreria già stilizzata.
- Recharts pesa intorno ai 100 KB compressi: per questo si carica solo nelle pagine con grafici.
- Con CSS Modules si scrivono più file per componente rispetto a classi di utilità.
- Le media query non possono leggere le custom properties: i punti di rottura sono ripetuti come valori letterali.
- `docs/design.md` e `tokens.css` sono due copie: il test le tiene allineate, ma ogni modifica va fatta due volte.

**Neutral**:
- Il colore d'accento verde petrolio (`#1f6f5c`) resta quello del prototipo e dello scaffold.
- Le date in React Aria usano `@internationalized/date`; la conversione verso `date-fns` di `core` avviene al bordo dei campi.

## Follow-up

- [ ] Spec 0002 (data model): confermare che i membri hanno `joinedAt` (o un ordine stabile) per il colore fisso per membro; altrimenti aggiungere un campo `colorSlot`.
- [ ] Feature 14 e 16 (dashboard, confronto periodi): scegliere quali grafici di `ui/charts/` servono e il testo dei riassunti.
- [ ] Feature 18 (report PDF): verificare che i grafici SVG di Recharts si esportino nel PDF e che il riempimento a righe regga la stampa in bianco e nero.
- [ ] Feature 22 (inglese): `format.ts` e `I18nProvider` prendono il locale da un'unica fonte.
