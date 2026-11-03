"""Divisione spese (feature 9, spec 0004): divisione predefinita della famiglia."""

from typing import Any

from test_filo import family_with_expense, register, uuid7
from test_inviti import invite


def test_ogni_membro_cambia_la_divisione_della_famiglia(clients: Any) -> None:
    owner, partner, stranger = clients(), clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    register(partner, "bruno@example.com")
    partner.post("/api/v1/invites/accept", json={"token": invite(owner, ctx["base"]), "displayName": "Bruno"})
    [partner_id] = [s["memberId"] for s in partner.get("/api/v1/families").json()]
    split = {"kind": "bp", "shares": {ctx["owner"]: 5000, partner_id: 5000}}
    url = f"{ctx['base']}/default-split"

    assert partner.put(url, json=split).status_code == 204
    [summary] = owner.get("/api/v1/families").json()
    assert summary["family"]["defaultSplit"] == split

    bad_sum = owner.put(url, json={"kind": "bp", "shares": {ctx["owner"]: 9999}})
    assert (bad_sum.status_code, bad_sum.json()["code"]) == (422, "invalid")
    not_member = owner.put(url, json={"kind": "bp", "shares": {uuid7(): 10000}})
    assert (not_member.status_code, not_member.json()["code"]) == (422, "invalid")

    register(stranger, "carla@example.com")
    assert stranger.put(url, json={"kind": "bp", "shares": {ctx["owner"]: 10000}}).status_code == 404


def test_un_membro_uscito_non_entra_nella_divisione(clients: Any) -> None:
    owner, partner = clients(), clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    register(partner, "bruno@example.com")
    partner.post("/api/v1/invites/accept", json={"token": invite(owner, ctx["base"]), "displayName": "Bruno"})
    [partner_id] = [s["memberId"] for s in partner.get("/api/v1/families").json()]
    assert partner.post(f"{ctx['base']}/leave").status_code == 204
    response = owner.put(
        f"{ctx['base']}/default-split", json={"kind": "bp", "shares": {ctx["owner"]: 5000, partner_id: 5000}}
    )
    assert response.status_code == 422
