from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from noi2contiamo_server.main import create_app
from noi2contiamo_server.settings import Settings


def test_health_crea_il_database_e_risponde_ok(tmp_path: Path) -> None:
    db_file = tmp_path / "sub" / "test.db"
    url = f"sqlite:///{db_file.as_posix()}"
    app = create_app(Settings(database_url=url, static_dir=str(tmp_path / "nessuna")))

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert db_file.exists()
    assert "alembic_version" in inspect(create_engine(url)).get_table_names()


def test_in_produzione_serve_il_segreto() -> None:
    try:
        create_app(Settings(env="production", secret_key=None))
    except RuntimeError as error:
        assert "N2C_SECRET_KEY" in str(error)
    else:
        raise AssertionError("il server doveva rifiutarsi di partire")
