"""Conti, categorie e destinatari (feature 7): nomi unici, un livello di categorie, destinatari usati."""

from typing import Any

from test_filo import family_with_expense, register, uuid7


def test_conti_con_nome_unico_tra_gli_attivi(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    twin = {"id": uuid7(), "name": " CONTO ", "kind": "cash", "initialBalanceDate": "2026-01-01"}
    response = owner.put(f"{ctx['base']}/accounts/{twin['id']}", json=twin)
    assert (response.status_code, response.json()["reason"]) == (409, "duplicate")
    archived = {**twin, "archivedAtMs": 1}
    assert owner.put(f"{ctx['base']}/accounts/{twin['id']}", json=archived).status_code == 200


def test_categorie_su_un_solo_livello(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    [parent] = owner.get(f"{ctx['base']}/categories").json()["docs"]
    child = {"id": uuid7(), "name": "Frutta", "kind": "expense", "parentId": parent["id"]}
    assert owner.put(f"{ctx['base']}/categories/{child['id']}", json=child).status_code == 200
    nephew = {"id": uuid7(), "name": "Mele", "kind": "expense", "parentId": child["id"]}
    assert owner.put(f"{ctx['base']}/categories/{nephew['id']}", json=nephew).status_code == 422
    income = {"id": uuid7(), "name": "Bonus", "kind": "income", "parentId": parent["id"]}
    assert owner.put(f"{ctx['base']}/categories/{income['id']}", json=income).status_code == 422
    twin = {**child, "id": uuid7(), "name": "FRUTTA"}
    assert owner.put(f"{ctx['base']}/categories/{twin['id']}", json=twin).status_code == 409


def test_destinatari_normalizzati_e_usati(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    payee = {"id": uuid7(), "name": "Caffè Roma", "normalizedName": "caffe roma"}
    assert owner.put(f"{ctx['base']}/payees/{payee['id']}", json=payee).status_code == 200
    wrong = {"id": uuid7(), "name": "Bar", "normalizedName": "altro"}
    assert owner.put(f"{ctx['base']}/payees/{wrong['id']}", json=wrong).status_code == 422
    twin = {"id": uuid7(), "name": "CAFFE ROMA", "normalizedName": "caffe roma"}
    assert owner.put(f"{ctx['base']}/payees/{twin['id']}", json=twin).status_code == 409
    tx = owner.get(f"{ctx['base']}/transactions/{ctx['tx']}").json()
    assert (
        owner.put(f"{ctx['base']}/transactions/{ctx['tx']}", json={**tx, "payeeId": payee["id"]}).status_code
        == 200
    )
    ghost = {**tx, "payeeId": uuid7()}
    assert owner.put(f"{ctx['base']}/transactions/{ctx['tx']}", json=ghost).status_code == 422
    assert owner.delete(f"{ctx['base']}/payees/{payee['id']}").status_code == 409
