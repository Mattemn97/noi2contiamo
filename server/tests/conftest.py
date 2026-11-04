"""Fixture comuni: un database SQLite temporaneo e "browser" con i loro cookie (vedi `test_filo.browser`)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_filo import browser

from noi2contiamo_server.main import create_app
from noi2contiamo_server.settings import Settings


@pytest.fixture
def url(tmp_path: Path) -> str:
    return f"sqlite:///{(tmp_path / 'filo.db').as_posix()}"


@pytest.fixture
def app(url: str, tmp_path: Path) -> Any:
    return create_app(Settings(database_url=url, static_dir=str(tmp_path / "nessuna")))


@pytest.fixture
def clients(app: Any) -> Iterator[Any]:
    opened: list[TestClient] = []

    def make() -> TestClient:
        client = browser(app)
        opened.append(client)
        return client

    yield make
    for client in opened:
        client.__exit__(None, None, None)
