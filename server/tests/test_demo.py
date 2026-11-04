"""Dati demo: si caricano una volta sola e si leggono dall'API come un utente vero."""

from datetime import date
from typing import Any

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from noi2contiamo_server.demo import DEMO_PASSWORD, DEMO_USERS, load_demo
from noi2contiamo_server.models import Transaction


def test_demo_si_carica_una_volta_e_il_login_funziona(clients: Any, url: str) -> None:
    client = clients()  # l'avvio dell'app applica le migrazioni
    with Session(create_engine(url)) as db:
        assert load_demo(db, today=date(2026, 11, 4)) is True
        assert load_demo(db, today=date(2026, 11, 4)) is False
        assert (db.scalar(select(func.count()).select_from(Transaction)) or 0) > 10

    login = {"email": DEMO_USERS[1][0], "password": DEMO_PASSWORD}
    assert client.post("/api/v1/auth/login", json=login).status_code == 200
    family = client.get("/api/v1/families").json()[0]
    listed = client.get(f"/api/v1/families/{family['family']['id']}/transactions").json()
    assert len(listed["docs"]) > 10
