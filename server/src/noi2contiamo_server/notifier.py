"""Invio dei promemoria (feature 19, spec 0001): il browser calcola e carica, il server consegna.

Un ciclo in-process cerca i promemoria `pending` già scaduti e li manda per email (SMTP) e Telegram, ciascun
canale solo se configurato e acceso dal membro. Niente doppi invii: i canali già serviti stanno sulla riga,
quindi un nuovo tentativo riprova solo quelli che hanno fallito, per al massimo `reminder_max_attempts` volte.
I segreti non lasciano mai il server e non finiscono nei log (si registra solo il tipo dell'errore).
"""

import asyncio
import json
import logging
import smtplib
import ssl
import urllib.request
from collections.abc import Mapping
from email.message import EmailMessage
from typing import Protocol

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from .models import Member, MemberSettings, Reminder, User
from .security import now_ms
from .settings import Settings

logger = logging.getLogger("noi2contiamo.notifier")

NETWORK_TIMEOUT_SECONDS = 15


class Sender(Protocol):
    """Un canale di consegna. `recipient` è l'email del membro; Telegram usa la chat configurata."""

    def send(self, recipient: str | None, title: str, body: str) -> None: ...


class EmailSender:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def send(self, recipient: str | None, title: str, body: str) -> None:
        if not recipient:
            raise ValueError("nessun indirizzo email")
        s = self._s
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = s.smtp_from or "", recipient, title
        message.set_content(body or title)
        if s.smtp_security == "ssl":
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                s.smtp_host or "",
                s.smtp_port,
                timeout=NETWORK_TIMEOUT_SECONDS,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(s.smtp_host or "", s.smtp_port, timeout=NETWORK_TIMEOUT_SECONDS)
        with client:
            if s.smtp_security == "starttls":
                client.starttls(context=ssl.create_default_context())
            if s.smtp_user:
                client.login(s.smtp_user, s.smtp_password or "")
            client.send_message(message)


class TelegramSender:
    def __init__(self, settings: Settings) -> None:
        self._token = settings.telegram_bot_token or ""
        self._chat = settings.telegram_chat_id or ""

    def send(self, recipient: str | None, title: str, body: str) -> None:
        payload = json.dumps({"chat_id": self._chat, "text": f"{title}\n{body}".strip()}).encode()
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{self._token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT_SECONDS):
            pass


def build_senders(settings: Settings) -> dict[str, Sender]:
    """I canali configurati; quelli senza variabili non compaiono."""
    senders: dict[str, Sender] = {}
    if settings.smtp_host and settings.smtp_from:
        senders["email"] = EmailSender(settings)
    if settings.telegram_bot_token and settings.telegram_chat_id:
        senders["telegram"] = TelegramSender(settings)
    return senders


def _wanted(db: Session, reminder: Reminder, senders: Mapping[str, Sender]) -> list[str]:
    row = db.get(MemberSettings, reminder.member_id)
    channels = row.channels if row is not None else {}
    return [name for name in senders if channels.get(name) is True]


def deliver_due(
    engine: Engine,
    senders: Mapping[str, Sender],
    *,
    max_attempts: int,
    max_age_ms: int,
    now: int | None = None,
) -> int:
    """Un giro di consegna. Restituisce quanti promemoria sono ora completamente inviati."""
    if not senders:
        return 0
    at = now_ms() if now is None else now
    completed = 0
    with Session(engine) as db:
        due = db.scalars(
            select(Reminder).where(
                Reminder.status == "pending",
                Reminder.fire_at_ms <= at,
                Reminder.fire_at_ms >= at - max_age_ms,
                Reminder.send_attempts < max_attempts,
            )
        ).all()
        for reminder in due:
            wanted = _wanted(db, reminder, senders)
            if not wanted:
                continue
            done = {c for c in reminder.sent_channels.split(",") if c}
            failed = False
            for name in (c for c in wanted if c not in done):
                recipient = _email_of(db, reminder) if name == "email" else None
                try:
                    senders[name].send(recipient, reminder.title, reminder.body)
                    done.add(name)
                except Exception as error:
                    failed = True
                    logger.warning("Invio %s fallito (%s): %s", name, reminder.id, type(error).__name__)
            reminder.sent_channels = ",".join(sorted(done))
            if failed:
                reminder.send_attempts += 1
                if reminder.send_attempts >= max_attempts:
                    logger.error("Promemoria %s: tentativi esauriti, non verrà più inviato.", reminder.id)
            if done >= set(wanted):
                reminder.status, reminder.sent_at_ms = "sent", at
                completed += 1
            db.commit()
    return completed


def _email_of(db: Session, reminder: Reminder) -> str | None:
    member = db.get(Member, reminder.member_id)
    if member is None or member.user_id is None:
        return None
    user = db.get(User, member.user_id)
    return user.email if user else None


async def run_scheduler(engine: Engine, settings: Settings, senders: Mapping[str, Sender]) -> None:
    """Ciclo periodico avviato nel lifespan di FastAPI; un errore non lo ferma."""
    max_age_ms = settings.reminder_max_age_hours * 3_600_000
    logger.info("Promemoria: canali attivi %s", ", ".join(sorted(senders)))
    while True:
        try:
            await asyncio.to_thread(
                deliver_due,
                engine,
                senders,
                max_attempts=settings.reminder_max_attempts,
                max_age_ms=max_age_ms,
            )
        except Exception:
            logger.exception("Giro di consegna dei promemoria fallito")
        await asyncio.sleep(settings.reminder_interval_seconds)
