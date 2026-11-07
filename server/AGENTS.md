# server

## Overview

Il server Python sottile (modalità self hosted): login, isolamento per famiglia, magazzino dati su SQLite (o PostgreSQL). Serve anche il frontend compilato. Nessuna logica di dominio: quella vive in `packages/core`.

## Key files

| File | Owns |
|---|---|
| `src/noi2contiamo_server/main.py` | app FastAPI, `GET /api/health`, file statici |
| `src/noi2contiamo_server/settings.py` | variabili `N2C_*` validate all'avvio |
| `src/noi2contiamo_server/db.py` | engine SQLAlchemy e migrazioni Alembic al primo avvio |
| `src/noi2contiamo_server/enable_banking.py` | client Enable Banking (JWT RS256), condiviso da `bank_api.py` e `bank_cli.py` |
| `src/noi2contiamo_server/bank_api.py` | route `/api/bank/*` (open banking, feature 24) |
| `alembic/versions/` | migrazioni |
| `tests/` | pytest con `TestClient` |

## Commands

```bash
node scripts/uv.mjs sync --project server              # dipendenze
npm run test:py                                         # pytest
node scripts/uv.mjs run --project server ruff check server   # lint
```

## Conventions

- Usa sempre `node scripts/uv.mjs` al posto di `uv` negli script: `uv` può non essere nel PATH.
- SQLAlchemy sincrono; endpoint sincroni (FastAPI li esegue in un thread pool).
- Importi come `INTEGER`/`BIGINT`, ogni tabella ha `family_id`, l'appartenenza si verifica in una dipendenza comune.
- Lint e format con Ruff (config in `pyproject.toml`).

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
