"""Open banking (feature 24): client Enable Banking e route /api/bank, senza rete (httpx MockTransport)."""

import json
import re
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from test_filo import family_with_expense, register

from noi2contiamo_server.enable_banking import BankError, EnableBankingClient, consent_days, make_jwt

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
PUBLIC = _KEY.public_key()

TX_PAGE_1 = {"transactions": [{"entry_reference": "1"}], "continuation_key": "k2"}
TX_PAGE_2 = {"transactions": [{"entry_reference": "2"}], "continuation_key": None}


class FakeBank:
    """Un Enable Banking finto: registra le richieste e controlla il JWT di ognuna."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.fail_with: tuple[int, dict[str, Any]] | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        token = request.headers["Authorization"].removeprefix("Bearer ")
        claims = jwt.decode(token, PUBLIC, algorithms=["RS256"], audience="api.enablebanking.com")
        assert claims["iss"] == "enablebanking.com"
        assert claims["exp"] - claims["iat"] == 3600
        header = jwt.get_unverified_header(token)
        assert header["kid"] == "app-1"
        assert header["typ"] == "JWT"
        if self.fail_with:
            return httpx.Response(self.fail_with[0], json=self.fail_with[1])
        path = request.url.path
        if path == "/aspsps":
            assert request.url.params["country"] == "IT"
            assert request.url.params["psu_type"] == "personal"
            banks = [
                {
                    "name": "Banca Prova",
                    "country": "IT",
                    "logo": "x.png",
                    "maximum_consent_validity": 90 * 86400,
                }
            ]
            return httpx.Response(200, json={"aspsps": banks})
        if path == "/auth":
            body = json.loads(request.content)
            assert body["aspsp"] == {"name": "Banca Prova", "country": "IT"}
            assert body["psu_type"] == "personal"
            assert body["redirect_url"].endswith("/importa/banca")
            return httpx.Response(200, json={"url": "https://bank.example/login", "authorization_id": "a"})
        if path == "/sessions" and request.method == "POST":
            assert json.loads(request.content) == {"code": "codice"}
            account = {
                "uid": "acc-1",
                "account_id": {"iban": "IT60X0542811101000000123456"},
                "name": "Conto",
                "currency": "EUR",
            }
            return httpx.Response(
                200,
                json={
                    "session_id": "sess-1",
                    "accounts": [account],
                    "access": {"valid_until": "2099-01-01T00:00:00+00:00"},
                },
            )
        if path == "/sessions/sess-1" and request.method == "DELETE":
            return httpx.Response(204)
        if path == "/accounts/acc-1/transactions":
            if request.url.params.get("continuation_key") == "k2":
                return httpx.Response(200, json=TX_PAGE_2)
            return httpx.Response(200, json=TX_PAGE_1)
        return httpx.Response(404, json={"message": "no"})


@pytest.fixture
def bank(app: Any) -> FakeBank:
    fake = FakeBank()
    app.state.bank_client_factory = lambda: EnableBankingClient(
        "app-1", PEM, transport=httpx.MockTransport(fake)
    )
    return fake


def test_jwt_rs256_con_kid_e_scadenza() -> None:
    claims = jwt.decode(
        make_jwt("app-1", PEM, 1000),
        PUBLIC,
        algorithms=["RS256"],
        audience="api.enablebanking.com",
        options={"verify_exp": False, "verify_iat": False},
    )
    assert claims["exp"] == 4600
    with pytest.raises(BankError) as error:
        make_jwt("app-1", "non una chiave")
    assert error.value.code == "not_configured"


def test_giorni_di_consenso() -> None:
    assert consent_days(90 * 86400) == 90
    assert consent_days(365 * 86400) == 180
    assert consent_days(30) == 30
    assert consent_days(None) == 90


def test_client_segue_la_continuation_key() -> None:
    client = EnableBankingClient("app-1", PEM, transport=httpx.MockTransport(FakeBank()))
    got = client.transactions("acc-1", "2026-01-01", "2026-02-01")
    assert [t["entry_reference"] for t in got] == ["1", "2"]


def test_errori_della_banca() -> None:
    fake = FakeBank()
    client = EnableBankingClient("app-1", PEM, transport=httpx.MockTransport(fake))
    fake.fail_with = (401, {"message": "Session expired"})
    with pytest.raises(BankError) as expired:
        client.transactions("acc-1", "2026-01-01", "2026-02-01")
    assert expired.value.code == "consent_expired"
    fake.fail_with = (500, {"message": "boom"})
    with pytest.raises(BankError) as other:
        client.aspsps("IT")
    assert (other.value.code, other.value.message) == ("bank_error", "boom")


def _ctx(clients: Any) -> tuple[Any, dict[str, str]]:
    owner = clients()
    register(owner, "anna@example.com")
    return owner, family_with_expense(owner)


def test_non_configurato(clients: Any) -> None:
    owner, ctx = _ctx(clients)
    status = owner.get("/api/bank/status", params={"familyId": ctx["family"]})
    assert status.json() == {"available": True, "configured": False, "canConfigure": False}
    response = owner.get("/api/bank/aspsps", params={"familyId": ctx["family"], "country": "IT"})
    assert response.status_code == 409
    assert response.json()["code"] == "not_configured"
    assert owner.put("/api/bank/config", json={}).status_code in (404, 405)


def test_filo_completo(clients: Any, bank: FakeBank) -> None:
    owner, ctx = _ctx(clients)
    fam = ctx["family"]
    assert owner.get("/api/bank/status", params={"familyId": fam}).json()["configured"] is True

    banks = owner.get("/api/bank/aspsps", params={"familyId": fam, "country": "IT"}).json()
    assert banks == [{"name": "Banca Prova", "country": "IT", "logo": "x.png", "maxConsentDays": 90}]

    body = {
        "familyId": fam,
        "aspspName": "Banca Prova",
        "country": "IT",
        "redirectUrl": "http://localhost:5173/importa/banca",
    }
    assert owner.post("/api/bank/auth", json=body).json() == {"url": "https://bank.example/login"}
    auth_call = next(c for c in bank.calls if c.url.path == "/auth")
    sent = json.loads(auth_call.content)
    assert re.fullmatch(r"[\w-]{20,}", sent["state"])
    assert sent["access"]["valid_until"]

    conn = owner.post("/api/bank/sessions", json={"familyId": fam, "code": "codice", "state": sent["state"]})
    assert conn.status_code == 200, conn.text
    connection = conn.json()
    assert connection["bankName"] == "Banca Prova"
    assert connection["accounts"] == [
        {"uid": "acc-1", "iban": "IT60X0542811101000000123456", "name": "Conto", "currency": "EUR"}
    ]
    assert "sess-1" not in conn.text  # la sessione resta sul server

    # lo state si usa una volta sola
    again = owner.post("/api/bank/sessions", json={"familyId": fam, "code": "codice", "state": sent["state"]})
    assert again.status_code == 403

    listed = owner.get("/api/bank/connections", params={"familyId": fam}).json()
    assert [c["id"] for c in listed] == [connection["id"]]

    params = {
        "familyId": fam,
        "connectionId": connection["id"],
        "accountUid": "acc-1",
        "dateFrom": "2026-01-01",
        "dateTo": "2026-02-01",
    }
    txs = owner.get("/api/bank/transactions", params=params)
    assert [t["entry_reference"] for t in txs.json()["transactions"]] == ["1", "2"]
    assert owner.get("/api/bank/transactions", params={**params, "accountUid": "altro"}).status_code == 404

    deleted = owner.delete(f"/api/bank/connections/{connection['id']}", params={"familyId": fam})
    assert deleted.status_code == 204
    assert any(c.method == "DELETE" and c.url.path == "/sessions/sess-1" for c in bank.calls)
    assert owner.get("/api/bank/connections", params={"familyId": fam}).json() == []


def test_isolamento_tra_famiglie_e_utenti(clients: Any, bank: FakeBank) -> None:
    owner, ctx = _ctx(clients)
    fam = ctx["family"]
    body = {
        "familyId": fam,
        "aspspName": "Banca Prova",
        "country": "IT",
        "redirectUrl": "http://x/importa/banca",
    }
    owner.post("/api/bank/auth", json=body)
    state = json.loads(next(c for c in bank.calls if c.url.path == "/auth").content)["state"]

    stranger = clients()
    register(stranger, "bruno@example.com")
    assert stranger.get("/api/bank/status", params={"familyId": fam}).status_code == 403
    mine = {"familyId": fam, "code": "c", "state": state}
    assert stranger.post("/api/bank/sessions", json=mine).status_code == 403
    other = family_with_expense(stranger)["family"]
    # lo state della famiglia di Anna non vale per un'altra famiglia, nemmeno dello stesso utente
    assert stranger.post("/api/bank/sessions", json={**mine, "familyId": other}).status_code == 403

    assert clients().get("/api/bank/status", params={"familyId": fam}).status_code == 401


def test_csrf_sulle_scritture(clients: Any, bank: FakeBank) -> None:
    owner, ctx = _ctx(clients)
    owner.headers.pop("X-CSRF-Token")
    body = {"familyId": ctx["family"], "aspspName": "x", "country": "IT", "redirectUrl": "http://x"}
    assert owner.post("/api/bank/auth", json=body).status_code == 403
