# packages/core

## Overview

Il dominio puro dell'app: divisioni, regole, ricorrenze, import CSV, saldi, totali. Gira nel browser e nei test senza database. Ogni calcolo di dominio passa da qui. Vale tutto il `## Rules` della radice.

## Key files

| File                 | Owns                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `src/index.ts`       | export pubblici del pacchetto (internal package: esporta i sorgenti `.ts`) |
| `src/money.ts`       | tipi `Cents` e `BasisPoints`, costruttori che rifiutano i decimali         |
| `src/purity.test.ts` | AC-7: controlla che nessun sorgente importi IO o pacchetti non ammessi     |

## Conventions

- Pacchetti esterni ammessi solo: `zod`, `date-fns`, `uuid`, `@noble/hashes`. Aggiungerne uno vuol dire aggiornare `ALLOWED_PACKAGES` nel test di purezza e la regola ESLint.
- Niente `fetch`, `window`, `document`, `localStorage` e simili, nemmeno nei commenti di codice reale.
- Funzioni pure, input e output, test senza mock.

## Gotchas

- Gli interi restano esatti fino a 2^53: `cents()` usa `Number.isSafeInteger`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
