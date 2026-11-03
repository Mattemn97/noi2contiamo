"""Import CSV (feature 11, spec 0006): profili e lotti, riferimenti, annullamento, impronte."""

from typing import Any

from test_filo import family_with_expense, register, uuid7

FP = "0123456789abcdef0123456789abcdef"


def _profile(account_id: str | None) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "name": "Intesa",
        "defaultAccountId": account_id,
        "encoding": "windows-1252",
        "delimiter": ";",
        "skipRows": 3,
        "hasHeader": True,
        "headerSignature": "a" * 32,
        "columns": {"date": {"header": "Data contabile"}, "description": [{"index": 2}]},
        "dateFormat": "dd/MM/yyyy",
        "decimalSeparator": ",",
        "thousandsSeparator": "",
        "sign": {"mode": "debitCreditColumns"},
    }


def _batch(account_id: str, profile_id: str | None) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "profileId": profile_id,
        "accountId": account_id,
        "fileName": "intesa.csv",
        "fileHash": "b" * 64,
        "rowCount": 2,
        "importedCount": 1,
        "duplicateCount": 1,
        "dateFrom": "2026-10-01",
        "dateTo": "2026-10-02",
        "importedAtMs": 1,
    }


def test_import_in_un_commit_e_annullamento(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base = ctx["base"]
    profile = _profile(ctx["account"])
    batch = _batch(ctx["account"], profile["id"])
    tx = {
        "id": uuid7(),
        "type": "expense",
        "date": "2026-10-01",
        "amountCents": 4530,
        "accountId": ctx["account"],
        "description": "Pagamento POS",
        "split": {"kind": "bp", "source": "default", "shares": {ctx["owner"]: 10000}},
        "importBatchId": batch["id"],
        "importFingerprints": [FP],
    }
    ops = [
        {"type": "put", "collection": "importProfiles", "doc": profile},
        {"type": "put", "collection": "importBatches", "doc": batch},
        {"type": "put", "collection": "transactions", "doc": tx},
    ]
    response = owner.post(f"{base}/commit", json={"ops": ops})
    assert response.status_code == 204, response.text

    saved = owner.get(f"{base}/importProfiles/{profile['id']}").json()
    assert saved["columns"] == profile["columns"]
    assert saved["thousandsSeparator"] == ""
    assert "amount" not in saved["columns"]
    found = owner.get(f"{base}/importProfiles", params={"where": '{"headerSignature": "' + "a" * 32 + '"}'})
    assert [p["id"] for p in found.json()["docs"]] == [profile["id"]]
    listed = owner.get(f"{base}/transactions", params={"where": '{"importBatchId": "' + batch["id"] + '"}'})
    assert [t["id"] for t in listed.json()["docs"]] == [tx["id"]]

    # Lotto con movimenti, profilo con lotti, conto con lotti: in uso.
    assert owner.delete(f"{base}/importBatches/{batch['id']}").json()["reason"] == "in_use"
    assert owner.delete(f"{base}/importProfiles/{profile['id']}").status_code == 409
    undo = [
        {"type": "remove", "collection": "transactions", "id": tx["id"]},
        {"type": "remove", "collection": "importBatches", "id": batch["id"]},
    ]
    assert owner.post(f"{base}/commit", json={"ops": undo}).status_code == 204
    assert owner.get(f"{base}/importBatches/{batch['id']}").status_code == 404
    # L'impronta sparisce con il movimento: lo stesso file si reimporta.
    again = {**tx, "id": uuid7(), "importBatchId": None}
    assert owner.put(f"{base}/transactions/{again['id']}", json=again).status_code == 200
    twin = {**again, "id": uuid7()}
    clash = owner.put(f"{base}/transactions/{twin['id']}", json=twin)
    assert clash.json()["reason"] == "duplicate_fingerprint"
    assert owner.delete(f"{base}/importProfiles/{profile['id']}").status_code == 204


def test_riferimenti_inesistenti_sono_422(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base = ctx["base"]
    ghost = uuid7()
    profile = _profile(ghost)
    assert owner.put(f"{base}/importProfiles/{profile['id']}", json=profile).status_code == 422
    batch = _batch(ghost, None)
    assert owner.put(f"{base}/importBatches/{batch['id']}", json=batch).status_code == 422
    batch = _batch(ctx["account"], ghost)
    assert owner.put(f"{base}/importBatches/{batch['id']}", json=batch).status_code == 422
    tx = owner.get(f"{base}/transactions/{ctx['tx']}").json()
    orphan = {**tx, "importBatchId": ghost}
    assert owner.put(f"{base}/transactions/{ctx['tx']}", json=orphan).status_code == 422


def test_profilo_con_forma_sbagliata(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    bad = {**_profile(None), "delimiter": "|"}
    assert owner.put(f"{ctx['base']}/importProfiles/{bad['id']}", json=bad).status_code == 422
    bad = {**_profile(None), "columns": {"date": {"index": 0}, "description": []}}
    assert owner.put(f"{ctx['base']}/importProfiles/{bad['id']}", json=bad).status_code == 422


def test_conto_usato_da_un_profilo_non_si_cancella(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base = ctx["base"]
    account = {"id": uuid7(), "name": "Revolut", "kind": "card", "initialBalanceDate": "2026-01-01"}
    assert owner.put(f"{base}/accounts/{account['id']}", json=account).status_code == 200
    profile = _profile(account["id"])
    assert owner.put(f"{base}/importProfiles/{profile['id']}", json=profile).status_code == 200
    assert owner.delete(f"{base}/accounts/{account['id']}").json()["reason"] == "in_use"
