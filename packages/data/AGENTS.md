# packages/data

## Overview

Il confine tra dominio e dati: l'interfaccia `DataAdapter` e le sue tre implementazioni (memory, firebase, http). `apps/web` sceglie l'adapter con un `import()` dinamico su `VITE_BACKEND`, così l'altro non finisce nel bundle.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | tipi `DataAdapter`, `AuthApi`, `CommitOp`, `chunkOps` (blocchi da 500) |
| `src/memory.ts` | adapter in memoria per test e demo |
| `src/firebase.ts` | adapter Firebase (Auth + Firestore), import `@noi2contiamo/data/firebase` |
| `src/http.ts` | adapter verso FastAPI `/api/v1`, import `@noi2contiamo/data/http` |
| `src/contract/suite.ts` | suite di contract test che ogni adapter deve passare |

## Conventions

- Ogni operazione ha lo scope di una famiglia (`familyId`); nessuna lettura tra famiglie.
- Un nuovo comportamento dell'adapter si aggiunge prima alla suite di contract test.
- Non importare `./firebase` dall'indice: romperebbe la build `http` (AC-2).

## Gotchas

- `commit` oltre 500 operazioni va spezzato con `chunkOps` (limite batch Firestore).

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
