"""Inviti ai membri della famiglia (feature 6): ingresso, rientro, ruoli, uscita e inviti non riscrivibili."""

from typing import Any

from test_filo import family_with_expense, register, uuid7


def invite(client: Any, base: str, **body: Any) -> str:
    response = client.post(f"{base}/invites", json={"id": uuid7(), **body})
    assert response.status_code == 201, response.text
    return response.json()["token"]


def test_il_partner_entra_e_vede_i_movimenti_comuni(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    token = invite(owner, ctx["base"])
    register(partner, "bruno@example.com")
    joined = partner.post("/api/v1/invites/accept", json={"token": token, "displayName": "Bruno"})
    assert joined.status_code == 200, joined.text
    assert joined.json()["familyId"] == ctx["family"]
    docs = partner.get(f"{ctx['base']}/transactions").json()["docs"]
    assert [d["id"] for d in docs] == [ctx["tx"]]
    again = partner.post("/api/v1/invites/accept", json={"token": token, "displayName": "Bruno"})
    assert (again.status_code, again.json()["code"]) == (410, "used")


def test_invito_scaduto_rifiutato(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    token = invite(owner, ctx["base"], expiresAtMs=1)
    register(partner, "bruno@example.com")
    response = partner.post("/api/v1/invites/accept", json={"token": token, "displayName": "Bruno"})
    assert (response.status_code, response.json()["code"]) == (410, "expired")
    assert partner.get(f"{ctx['base']}/transactions").status_code == 404


def test_chi_esce_rientra_con_lo_stesso_membro(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    register(partner, "bruno@example.com")
    partner.post("/api/v1/invites/accept", json={"token": invite(owner, ctx["base"]), "displayName": "Bruno"})
    [first] = [s["memberId"] for s in partner.get("/api/v1/families").json()]
    assert partner.post(f"{ctx['base']}/leave").status_code == 204
    assert partner.get("/api/v1/families").json() == []
    rejoin = partner.post(
        "/api/v1/invites/accept", json={"token": invite(owner, ctx["base"]), "displayName": "B"}
    )
    assert rejoin.status_code == 200, rejoin.text
    assert [s["memberId"] for s in partner.get("/api/v1/families").json()] == [first]


def test_un_invito_si_puo_solo_revocare(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    token = invite(owner, ctx["base"])
    register(partner, "bruno@example.com")
    partner.post("/api/v1/invites/accept", json={"token": token, "displayName": "Bruno"})
    [used] = owner.get(f"{ctx['base']}/invites").json()["docs"]
    reset = owner.put(
        f"{ctx['base']}/invites/{used['id']}", json={**used, "usedAtMs": None, "usedByUserId": None}
    )
    assert reset.status_code == 403
    revoked = owner.put(f"{ctx['base']}/invites/{used['id']}", json={**used, "revokedAtMs": 5})
    assert revoked.status_code == 200, revoked.text


def test_solo_il_proprietario_toglie_un_membro(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    register(partner, "bruno@example.com")
    partner.post("/api/v1/invites/accept", json={"token": invite(owner, ctx["base"]), "displayName": "Bruno"})
    members = {m["displayName"]: m for m in owner.get(f"{ctx['base']}/members").json()["docs"]}
    anna, bruno = members["Anna"], members["Bruno"]
    assert partner.put(f"{ctx['base']}/members/{anna['id']}", json={**anna, "leftAtMs": 9}).status_code == 403
    assert owner.put(f"{ctx['base']}/members/{bruno['id']}", json={**bruno, "leftAtMs": 9}).status_code == 200
    assert partner.get(f"{ctx['base']}/transactions").status_code == 404
