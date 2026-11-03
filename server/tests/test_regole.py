"""Regole automatiche (feature 12, spec 0007): forma, riferimenti della famiglia, ordine, isolamento."""

from typing import Any

from test_filo import family_with_expense, register, uuid7


def _rule(category_id: str, order: int = 0, **actions: Any) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "name": "Esselunga",
        "order": order,
        "conditions": {"match": "any", "description": {"op": "pattern", "value": "pos * esselunga*"}},
        "actions": {"categoryId": category_id, **actions},
    }


def _category(owner: Any, base: str) -> str:
    return str(owner.get(f"{base}/categories").json()["docs"][0]["id"])


def test_regola_salvata_e_letta_in_ordine(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base, category = ctx["base"], _category(owner, ctx["base"])
    second = _rule(category, order=1, split={"kind": "bp", "shares": {ctx["owner"]: 10000}})
    first = {**_rule(category, order=0), "conditions": {"memberIds": [ctx["owner"]], "amountMinCents": 1}}
    first["actions"] = {"recurring": True}
    ops = [{"type": "put", "collection": "rules", "doc": d} for d in (second, first)]
    assert owner.post(f"{base}/commit", json={"ops": ops}).status_code == 204
    listed = owner.get(f"{base}/rules", params={"orderBy": "order_asc"}).json()["docs"]
    assert [r["id"] for r in listed] == [first["id"], second["id"]]
    assert listed[1]["conditions"] == second["conditions"]
    assert listed[1]["actions"]["split"] == second["actions"]["split"]
    assert listed[0]["conditions"]["match"] == "all"
    assert listed[0]["actions"] == {"recurring": True}
    enabled = owner.get(f"{base}/rules", params={"where": '{"enabled": true}'}).json()["docs"]
    assert len(enabled) == 2
    assert owner.delete(f"{base}/rules/{first['id']}").status_code == 204


def test_forma_sbagliata_e_riferimenti_inesistenti_sono_422(clients: Any) -> None:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    base, category = ctx["base"], _category(owner, ctx["base"])
    ghost = uuid7()
    bad = [
        {**_rule(category), "conditions": {"match": "all"}},
        {**_rule(category), "actions": {}},
        {**_rule(category), "conditions": {"amountMinCents": 10, "amountMaxCents": 5}},
        _rule(category, transferAccountId=ctx["account"]),
        {**_rule(category), "conditions": {"description": {"op": "regex", "value": ".*"}}},
        _rule(ghost),
        {**_rule(category), "conditions": {"accountIds": [ghost]}},
        {**_rule(category), "conditions": {"memberIds": [ghost]}},
        _rule(category, payeeId=ghost),
        {**_rule(category), "actions": {"transferAccountId": ghost}},
        _rule(category, split={"kind": "bp", "shares": {ghost: 10000}}),
        _rule(category, split={"kind": "bp", "shares": {ctx["owner"]: 9000}}),
    ]
    for doc in bad:
        response = owner.put(f"{base}/rules/{doc['id']}", json=doc)
        assert response.status_code == 422, doc


def test_regole_di_unaltra_famiglia(clients: Any) -> None:
    anna, bruno = clients(), clients()
    register(anna, "anna@example.com")
    register(bruno, "bruno@example.com")
    mine = family_with_expense(anna)
    other = family_with_expense(bruno)
    rule = _rule(_category(anna, mine["base"]))
    assert anna.put(f"{mine['base']}/rules/{rule['id']}", json=rule).status_code == 200
    assert bruno.get(f"{mine['base']}/rules/{rule['id']}").status_code == 404
    assert bruno.put(f"{mine['base']}/rules/{rule['id']}", json=rule).status_code == 404
    # Categoria di un'altra famiglia nella propria regola: 422.
    stolen = _rule(_category(anna, mine["base"]))
    assert bruno.put(f"{other['base']}/rules/{stolen['id']}", json=stolen).status_code == 422
