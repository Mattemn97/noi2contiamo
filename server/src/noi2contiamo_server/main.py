import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from .api import router
from .db import make_engine, run_migrations
from .errors import install_error_handlers
from .security import CsrfMiddleware
from .settings import Settings, get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("noi2contiamo")


class SpaStaticFiles(StaticFiles):
    """File statici con ritorno a `index.html`, così le route della SPA (/movimenti) reggono il ricarica."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as error:
            if error.status_code != 404 or path.startswith("api") or "." in path.rsplit("/", 1)[-1]:
                raise
            return await super().get_response("index.html", scope)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.resolved_secret_key()  # si rifiuta di partire senza segreto in produzione

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        run_migrations(settings.database_url)
        app.state.engine = make_engine(settings.database_url)
        yield
        app.state.engine.dispose()

    app = FastAPI(title="Noi2Contiamo", lifespan=lifespan)
    app.state.settings = settings
    install_error_handlers(app)
    app.add_middleware(CsrfMiddleware)
    app.include_router(router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    static_dir = Path(settings.static_dir)
    if static_dir.is_dir():
        app.mount("/", SpaStaticFiles(directory=static_dir, html=True), name="web")
    else:
        logger.warning("Cartella del frontend non trovata (%s): servo solo /api.", static_dir)

    return app


app = create_app()
