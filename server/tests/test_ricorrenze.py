"""Ricorrenze e scarti dei suggerimenti (feature 13, spec 0008): forma, riferimenti, isolamento."""

from typing import Any

from test_filo import family_with_expense, register, uuid7


def _rec(ctx: dict[str, str], **extra: Any) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "name": "Affitto",
        "type": "expense",
        "accountId": ctx["account"],
        "expectedAmountCents": 70000,
        "frequency": {"unit": "month", "interval": 1, "count": 12},
        "startDate": "2026-01-05",
        **extra,
    }


def test_ricorrenza_collegata_a_un_movimento_e_scarto_con_chiave(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base = ctx["base"]
    rec = _rec(ctx)
    assert owner.put(f"{base}/recurrences/{rec['id']}", json=rec).status_code == 200
    got = owner.get(f"{base}/recurrences/{rec['id']}").json()
    assert got["frequency"] == rec["frequency"]
    assert got["skippedDates"] == [] and got["amountToleranceBp"] == 1000
    tx = owner.get(f"{base}/transactions/{ctx['tx']}").json()
    tx |= {"recurrenceId": rec["id"], "recurrenceDueDate": "2026-11-05"}
    assert owner.put(f"{base}/transactions/{ctx['tx']}", json=tx).status_code == 200
    assert owner.delete(f"{base}/recurrences/{rec['id']}").status_code == 409

    key = "a" * 32
    dismissal = {"id": key, "dismissedAtMs": 1, "dismissedByMemberId": ctx["owner"]}
    assert owner.put(f"{base}/recurrenceDismissals/{key}", json=dismissal).status_code == 200
    assert owner.get(f"{base}/recurrenceDismissals/{key}").json()["id"] == key
    assert [d["id"] for d in owner.get(f"{base}/recurrenceDismissals").json()["docs"]] == [key]
    assert owner.delete(f"{base}/recurrenceDismissals/{key}").status_code == 204


def test_forma_sbagliata_e_riferimenti_inesistenti_sono_422(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base, ghost = ctx["base"], uuid7()
    bad = [
        _rec(ctx, accountId=ghost),
        _rec(ctx, toAccountId=ghost, type="transfer"),
        _rec(ctx, categoryId=ghost),
        _rec(ctx, payeeId=ghost),
        _rec(ctx, split={"kind": "bp", "source": "manual", "shares": {ghost: 10000}}),
        _rec(ctx, toAccountId=ctx["account"]),
        _rec(ctx, type="transfer"),
        _rec(ctx, frequency={"unit": "month", "interval": 0}),
        _rec(ctx, frequency={"unit": "month", "interval": 1, "count": 1001}),
    ]
    for doc in bad:
        assert owner.put(f"{base}/recurrences/{doc['id']}", json=doc).status_code == 422, doc
    tx = owner.get(f"{base}/transactions/{ctx['tx']}").json()
    tx |= {"recurrenceId": ghost, "recurrenceDueDate": "2026-11-05"}
    assert owner.put(f"{base}/transactions/{ctx['tx']}", json=tx).status_code == 422


def test_ricorrenza_di_unaltra_famiglia_e_404(clients: Any) -> None:
    anna, bruno = clients(), clients()
    register(anna, "anna@example.com")
    register(bruno, "bruno@example.com")
    mine, other = family_with_expense(anna), family_with_expense(bruno)
    rec = _rec(mine)
    assert anna.put(f"{mine['base']}/recurrences/{rec['id']}", json=rec).status_code == 200
    assert bruno.get(f"{mine['base']}/recurrences/{rec['id']}").status_code == 404
    assert bruno.put(f"{other['base']}/recurrences/{rec['id']}", json=rec).status_code == 422
