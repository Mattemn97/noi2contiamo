"""Filo base (feature 5): accesso, famiglia, primo movimento, isolamento tra famiglie, CSRF."""

import secrets
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from noi2contiamo_server.main import create_app
from noi2contiamo_server.models import Session as SessionRow
from noi2contiamo_server.models import User
from noi2contiamo_server.settings import Settings

PASSWORD = "password-di-prova"
# Su localhost il cookie non è Secure (N2C_COOKIE_SECURE=auto), come in `npm run local`.
LOCAL = "http://localhost"


def uuid7() -> str:
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    value = (value & ~(0xF << 76)) | (0x7 << 76)
    value = (value & ~(0x3 << 62)) | (0x2 << 62)
    return str(uuid.UUID(int=value))


def browser(app: Any) -> TestClient:
    """Un client con il suo barattolo di cookie e il token CSRF già preso, come la SPA."""
    client = TestClient(app, base_url=LOCAL)
    client.__enter__()
    token = client.get("/api/v1/auth/session").json()["csrfToken"]
    client.headers["X-CSRF-Token"] = token
    return client


def register(client: TestClient, email: str) -> dict[str, Any]:
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


def family_with_expense(client: TestClient) -> dict[str, str]:
    family_id, owner_id, category_id, account_id, tx_id = (uuid7() for _ in range(5))
    response = client.post(
        "/api/v1/families",
        json={
            "family": {"id": family_id, "name": "Casa"},
            "ownerMember": {"id": owner_id, "displayName": "Anna"},
            "defaults": {"categories": [{"id": category_id, "name": "Spesa Alimentare", "kind": "expense"}]},
        },
    )
    assert response.status_code == 201, response.text
    base = f"/api/v1/families/{family_id}"
    account = {"id": account_id, "name": "Conto", "kind": "checking", "initialBalanceDate": "2026-01-01"}
    assert client.put(f"{base}/accounts/{account_id}", json=account).status_code == 200
    tx = {
        "id": tx_id,
        "type": "expense",
        "date": "2026-11-03",
        "amountCents": 4250,
        "accountId": account_id,
        "categoryId": category_id,
        "description": "Supermercato",
        "split": {"kind": "bp", "source": "default", "shares": {owner_id: 10000}},
    }
    response = client.put(f"{base}/transactions/{tx_id}", json=tx)
    assert response.status_code == 200, response.text
    return {"family": family_id, "owner": owner_id, "account": account_id, "tx": tx_id, "base": base}


def test_registrazione_salva_la_password_con_argon2id_e_apre_una_sessione(clients: Any, url: str) -> None:
    client = clients()
    user = register(client, "Anna@Example.com")
    assert user["email"] == "anna@example.com"
    assert client.get("/api/v1/auth/session").json()["user"] == user
    cookie = next(c for c in client.cookies.jar if c.name == "n2c_session")
    with Session(create_engine(url)) as db:
        row = db.scalars(select(User)).one()
        assert row.password_hash.startswith("$argon2id$")
        assert PASSWORD not in row.password_hash
        stored = db.scalars(select(SessionRow)).one()
        assert stored.token_hash != cookie.value  # nel database solo l'hash del token
    assert cookie.has_nonstandard_attr("HttpOnly")


def test_email_doppia_password_corta_e_credenziali_sbagliate(clients: Any) -> None:
    client = clients()
    register(client, "anna@example.com")
    again = client.post("/api/v1/auth/register", json={"email": "anna@example.com", "password": PASSWORD})
    assert again.status_code == 409
    short = client.post("/api/v1/auth/register", json={"email": "b@example.com", "password": "corta"})
    assert short.status_code == 422
    wrong = client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": "sbagliata!"})
    assert wrong.status_code == 401
    nobody = client.post("/api/v1/auth/login", json={"email": "nessuno@example.com", "password": PASSWORD})
    assert nobody.status_code == 401


def test_logout_chiude_la_sessione(clients: Any) -> None:
    client = clients()
    register(client, "anna@example.com")
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/session").json()["user"] is None
    assert client.get("/api/v1/families").status_code == 401
    login = client.post("/api/v1/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert login.status_code == 200
    assert client.get("/api/v1/families").status_code == 200


def test_senza_token_csrf_le_scritture_sono_rifiutate(app: Any) -> None:
    with TestClient(app, base_url=LOCAL) as client:
        response = client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": PASSWORD})
        assert response.status_code == 403
        client.get("/api/v1/auth/session")
        client.headers["X-CSRF-Token"] = "un-altro-valore"
        response = client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": PASSWORD})
        assert response.status_code == 403
        assert response.json() == {"code": "forbidden", "message": "csrf"}


def test_famiglia_conto_spesa_e_registro(clients: Any) -> None:
    client = clients()
    register(client, "anna@example.com")
    ids = family_with_expense(client)
    [summary] = client.get("/api/v1/families").json()
    assert summary["memberId"] == ids["owner"] and summary["role"] == "owner"
    assert summary["family"]["defaultSplit"] == {"kind": "bp", "shares": {ids["owner"]: 10000}}
    page = client.get(f"{ids['base']}/transactions").json()
    assert page["next"] is None
    [tx] = page["docs"]
    assert tx["amountCents"] == 4250 and tx["createdByMemberId"] == ids["owner"]
    assert tx["visibility"] == "shared" and tx["importFingerprints"] == []


def test_movimento_non_valido_rifiutato(clients: Any) -> None:
    client = clients()
    register(client, "anna@example.com")
    ids = family_with_expense(client)
    tx = client.get(f"{ids['base']}/transactions/{ids['tx']}").json()
    for patch in ({"amountCents": 10.5}, {"amountCents": 0}, {"date": "2026-02-30"}, {"campo": 1}):
        response = client.put(f"{ids['base']}/transactions/{ids['tx']}", json={**tx, **patch})
        assert response.status_code == 422, patch
        assert response.json()["code"] == "invalid"
    wrong_account = {**tx, "accountId": uuid7()}
    assert client.put(f"{ids['base']}/transactions/{ids['tx']}", json=wrong_account).status_code == 422


def test_un_altra_famiglia_non_legge_ne_modifica(clients: Any) -> None:
    anna, estraneo = clients(), clients()
    register(anna, "anna@example.com")
    ids = family_with_expense(anna)
    register(estraneo, "estraneo@example.com")
    family_with_expense(estraneo)  # ha la sua famiglia: non basta essere membri di una famiglia qualsiasi
    tx = anna.get(f"{ids['base']}/transactions/{ids['tx']}").json()

    assert estraneo.get(f"{ids['base']}/transactions").status_code == 404
    assert estraneo.get(f"{ids['base']}/transactions/{ids['tx']}").status_code == 404
    assert estraneo.get(f"{ids['base']}/accounts").status_code == 404
    assert estraneo.get(f"{ids['base']}/members").status_code == 404
    changed = {**tx, "amountCents": 1}
    assert estraneo.put(f"{ids['base']}/transactions/{ids['tx']}", json=changed).status_code == 404
    assert estraneo.delete(f"{ids['base']}/transactions/{ids['tx']}").status_code == 404
    assert estraneo.post(f"{ids['base']}/commit", json={"ops": []}).status_code == 404
    assert [f["family"]["id"] for f in estraneo.get("/api/v1/families").json()] != [ids["family"]]
    assert anna.get(f"{ids['base']}/transactions/{ids['tx']}").json()["amountCents"] == 4250


def test_senza_sessione_401(app: Any) -> None:
    with TestClient(app, base_url=LOCAL) as client:
        assert client.get("/api/v1/families").status_code == 401
        assert client.get(f"/api/v1/families/{uuid7()}/transactions").status_code == 401


def test_la_spa_regge_il_ricarica_sulle_sue_route(url: str, tmp_path: Path) -> None:
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>Noi2Contiamo</title>", encoding="utf-8")
    app = create_app(Settings(database_url=url, static_dir=str(static)))
    with TestClient(app, base_url=LOCAL) as client:
        assert "Noi2Contiamo" in client.get("/movimenti/nuovo").text
        assert client.get("/api/v1/inesistente").status_code == 404
        assert client.get("/manca.js").status_code == 404
