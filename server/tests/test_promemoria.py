"""Promemoria e impostazioni (feature 19): API, consegna con invii finti, niente doppi invii."""

from typing import Any

import pytest
from pydantic import ValidationError
from test_filo import family_with_expense, register, uuid7

from noi2contiamo_server.notifier import build_senders, deliver_due
from noi2contiamo_server.settings import Settings

NOW = 2_000_000_000_000
DAY = 86_400_000


class FakeSender:
    def __init__(self, fail: int = 0) -> None:
        self.sent: list[tuple[str | None, str, str]] = []
        self.fail = fail

    def send(self, recipient: str | None, title: str, body: str) -> None:
        if self.fail > 0:
            self.fail -= 1
            raise ConnectionError("rete assente")
        self.sent.append((recipient, title, body))


def _reminder(ctx: dict[str, str], key: str = "recurringDue|r|2026-11-10", **extra: Any) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "memberId": ctx["owner"],
        "kind": "recurringDue",
        "fireAtMs": NOW - 1000,
        "title": "Affitto tra 2 giorni",
        "body": "800,00 EUR",
        "dedupKey": key,
        **extra,
    }


def _setup(clients: Any, channels: dict[str, bool] | None = None) -> tuple[Any, dict[str, str]]:
    owner = clients()
    register(owner, "anna@example.com")
    ctx = family_with_expense(owner)
    if channels is not None:
        settings = {"id": ctx["owner"], "channels": channels}
        assert owner.put(f"{ctx['base']}/memberSettings/{ctx['owner']}", json=settings).status_code == 200
    return owner, ctx


def _deliver(app: Any, senders: dict[str, Any], **extra: Any) -> int:
    args = {"max_attempts": 3, "max_age_ms": 3 * DAY, "now": NOW} | extra
    return deliver_due(app.state.engine, senders, **args)


def test_impostazioni_con_default_e_promemoria_senza_stato_inviato_dal_client(clients: Any) -> None:
    owner, ctx = _setup(clients)
    base = ctx["base"]
    owner.put(f"{base}/memberSettings/{ctx['owner']}", json={"id": ctx["owner"]})
    got = owner.get(f"{base}/memberSettings/{ctx['owner']}").json()
    assert got["notifications"]["recurringDue"] == {"enabled": True, "leadDays": 2}
    assert got["channels"]["email"] is False and got["defaultView"] == "family"

    rem = _reminder(ctx, status="sent", sentAtMs=5)
    assert owner.put(f"{base}/reminders/{rem['id']}", json=rem).status_code == 200
    stored = owner.get(f"{base}/reminders/{rem['id']}").json()
    assert stored["status"] == "pending" and stored["sentAtMs"] is None
    clash = _reminder(ctx)
    assert owner.put(f"{base}/reminders/{clash['id']}", json=clash).status_code == 409
    other = _reminder(ctx, memberId=uuid7())
    assert owner.put(f"{base}/reminders/{other['id']}", json=other).status_code == 403


def test_invio_su_tutti_i_canali_acceso_una_sola_volta(clients: Any, app: Any) -> None:
    owner, ctx = _setup(clients, {"email": True, "telegram": True})
    rem = _reminder(ctx)
    owner.put(f"{ctx['base']}/reminders/{rem['id']}", json=rem)
    email, telegram = FakeSender(), FakeSender()
    senders = {"email": email, "telegram": telegram}

    assert _deliver(app, senders) == 1
    assert email.sent == [("anna@example.com", rem["title"], rem["body"])]
    assert telegram.sent == [(None, rem["title"], rem["body"])]
    done = owner.get(f"{ctx['base']}/reminders/{rem['id']}").json()
    assert done["status"] == "sent" and done["sentAtMs"] == NOW

    assert _deliver(app, senders) == 0  # nessun doppio invio
    assert len(email.sent) == len(telegram.sent) == 1
    again = owner.put(f"{ctx['base']}/reminders/{rem['id']}", json=rem | {"status": "pending"})
    assert again.json()["status"] == "sent"


def test_un_canale_che_fallisce_si_riprova_senza_rimandare_agli_altri_e_si_ferma(
    clients: Any, app: Any
) -> None:
    owner, ctx = _setup(clients, {"email": True, "telegram": True})
    rem = _reminder(ctx)
    owner.put(f"{ctx['base']}/reminders/{rem['id']}", json=rem)
    email, telegram = FakeSender(fail=1), FakeSender()
    senders = {"email": email, "telegram": telegram}

    assert _deliver(app, senders) == 0
    assert len(telegram.sent) == 1 and email.sent == []
    assert _deliver(app, senders) == 1
    assert len(telegram.sent) == 1 and len(email.sent) == 1

    broken = _reminder(ctx, key="settlement||2026-11", kind="settlement")
    owner.put(f"{ctx['base']}/reminders/{broken['id']}", json=broken)
    dead = {"email": FakeSender(fail=99)}
    for _ in range(5):
        assert _deliver(app, dead, max_attempts=2) == 0
    assert dead["email"].fail == 99 - 2  # solo i tentativi consentiti
    still = owner.get(f"{ctx['base']}/reminders/{broken['id']}").json()
    assert still["status"] == "pending"


def test_non_invia_se_il_canale_e_spento_futuro_o_troppo_vecchio(clients: Any, app: Any) -> None:
    owner, ctx = _setup(clients, {"email": False, "telegram": True})
    future = _reminder(ctx, key="a", fireAtMs=NOW + DAY)
    old = _reminder(ctx, key="b", fireAtMs=NOW - 10 * DAY)
    now_due = _reminder(ctx, key="c")
    for rem in (future, old, now_due):
        owner.put(f"{ctx['base']}/reminders/{rem['id']}", json=rem)
    email, telegram = FakeSender(), FakeSender()

    assert _deliver(app, {"email": email, "telegram": telegram}) == 1
    assert email.sent == [] and len(telegram.sent) == 1
    assert _deliver(app, {}) == 0


def test_canali_spenti_in_silenzio_e_configurazione_validata() -> None:
    assert build_senders(Settings()) == {}
    full = Settings(
        smtp_host="smtp.example.com",
        smtp_from="n2c@example.com",
        telegram_bot_token="t",
        telegram_chat_id="1",
    )
    assert sorted(build_senders(full)) == ["email", "telegram"]
    with pytest.raises(ValidationError):
        Settings(smtp_host="smtp.example.com")
    with pytest.raises(ValidationError):
        Settings(telegram_bot_token="t")
