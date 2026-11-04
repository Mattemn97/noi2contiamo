# Noi2Contiamo

## Stack

- **Language / Runtime**: TypeScript 6.0 `strict` (Node 24, `engines.node >=22`); Python >=3.12 per il server
- **Framework**: React 19.3 + Vite 8.3 (PWA con `vite-plugin-pwa`); FastAPI 0.162 + SQLAlchemy 2.1 + Alembic 1.20
- **Key dependencies**: `packages/core` (dominio puro), `packages/data` (`DataAdapter`: memory, firebase, http), Firebase 13.2 (piano Spark), zod, date-fns, uuid v7
- **Package manager**: npm workspaces (`apps/*`, `packages/*`); `uv` per `server/` (lancialo con `node scripts/uv.mjs`, funziona anche se `uv` non è nel PATH)
- Fonte: [docs/specs/0001-stack-architettura](docs/specs/0001-stack-architettura/index.md)

## Build approach

Tracer Bullet: prima un filo sottile ma reale che attraversa tutti i livelli, poi ogni slice lo ispessisce, sempre end to end.

## Commands

```bash
npm install                 # tutti i workspace (+ `node scripts/uv.mjs sync --project server` per Python)
npm run dev:local           # Vite + Uvicorn insieme (proxy /api verso :8000)
npm run build               # typecheck + build web (VITE_BACKEND=http)
npm run local               # build + server Python su http://localhost:8000
npm run demo                # dati demo inventati (solo server Python)
npm run check               # typecheck + lint + tutti i test, prima di dire "fatto"
npm run lint:fix            # corregge lint e formato in automatico
```

## Testing

- Tutto gira in locale; la CI non serve (al massimo un workflow manuale).
- Al commit: l'hook `pre-commit` lancia ESLint, Prettier e Ruff solo sui file in stage. Veloce, niente test.
- Mentre lavori: `npm run test:ts` (Vitest) o `npm run test:py` (pytest) sulla parte che tocchi.
- Prima di chiudere una feature o aprire una PR: `npm run check` deve passare.
- Opzionali, quando servono: `npm run test:rules` (emulatore Firestore, serve Java), `npm run test:contract:http`.

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title/index.md`.

## Rules

- Stile funzionale: funzioni pure di default, dati immutabili (`const`, `readonly`), niente stato mutabile condiviso.
- L'IO (rete, storage, SDK) sta ai bordi: `packages/data` e `server/`. `packages/core` non importa React, Firebase, `fetch` né API del browser (lo controllano un test e una regola ESLint).
- Errori attesi come valori di ritorno espliciti (tipo `Result`), eccezioni solo per bug e casi impossibili.
- Denaro sempre in centesimi interi (`Cents`), percentuali in punti base (10000 = 100%). Mai decimali per gli importi, in nessun livello.
- Ogni dato è isolato per famiglia, in entrambi i backend; i due adapter passano la stessa suite di contract test.
- TypeScript `strict`, niente `any`. Solo export con nome (niente `export default`, tranne i file di config).
- Struttura per feature dentro ogni workspace; i test stanno accanto al codice (`*.test.ts`, `server/tests/`).
- Variabili d'ambiente validate all'avvio (`pydantic-settings` nel server). Testi UI in italiano dal catalogo `apps/web/src/i18n/it.ts`. UI accessibile (WCAG AA), tema chiaro e scuro.
- Commit nel formato conventional commits (`feat:`, `fix:`, `chore:` ...).
- Tooling: ESLint 10 + typescript-eslint + Prettier per TS, Ruff (lint e format) per Python, `simple-git-hooks` + `lint-staged` per il hook di commit.

## Git

- integration: off

## Agent skills

Workflow skills in `.claude/skills/` (`jsmastery-pro/skills`): architect, audit, check, debug, develop, document, scope, sync, test. Nessuna skill di stack installata.

## Context files

- [packages/core/AGENTS.md](packages/core/AGENTS.md) (dominio puro, regole su IO e denaro)
- [packages/data/AGENTS.md](packages/data/AGENTS.md) (contratto `DataAdapter` e adapter)
- [server/AGENTS.md](server/AGENTS.md) (server Python FastAPI, uv, Alembic)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
