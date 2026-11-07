"""Route `/api/bank/*` (open banking, feature 24): stessa API della Cloud Function `bank`.

Il browser non può chiamare Enable Banking (niente CORS): il server firma il JWT e inoltra. Le chiavi
vengono da `N2C_ENABLE_BANKING_APP_ID` / `N2C_ENABLE_BANKING_KEY_FILE`; collegamenti e richieste in corso
stanno nel database, isolati per famiglia e visibili solo a chi ha collegato la banca.
"""

import contextlib
import datetime as dt
import secrets
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .enable_banking import BankError, EnableBankingClient, consent_days, summarize_session
from .errors import ApiError
from .models import BankAuthState, BankConnection, User
from .scope import active_member
from .security import current_user, get_db, now_ms
from .settings import Settings

STATE_TTL_MS = 30 * 60 * 1000
ISO_DAY = r"^\d{4}-\d{2}-\d{2}$"
COUNTRY = r"^[A-Z]{2}$"

router = APIRouter(prefix="/api/bank")
Db = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user)]
FamilyQuery = Annotated[uuid.UUID, Query(alias="familyId")]


class Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class AuthIn(Body):
    family_id: uuid.UUID
    aspsp_name: str = Field(min_length=1, max_length=200)
    country: str = Field(pattern=COUNTRY)
    redirect_url: str = Field(min_length=1, max_length=1000)


class SessionIn(Body):
    family_id: uuid.UUID
    code: str = Field(min_length=1, max_length=2000)
    state: str = Field(min_length=1, max_length=64)


def bank_client(request: Request) -> EnableBankingClient:
    """Il client dell'app configurata, o `not_configured`. I test sostituiscono `bank_client_factory`."""
    factory = getattr(request.app.state, "bank_client_factory", None)
    client: EnableBankingClient | None = None
    if factory is not None:
        client = factory()
    else:
        settings: Settings = request.app.state.settings
        if settings.enable_banking_app_id and settings.enable_banking_key_file:
            try:
                pem = Path(settings.enable_banking_key_file).read_text(encoding="utf-8")
            except OSError as error:
                raise ApiError(
                    "not_configured", message="Il file della chiave privata non si legge."
                ) from error
            client = EnableBankingClient(settings.enable_banking_app_id, pem)
    if client is None:
        raise ApiError("not_configured", message="Open banking non è configurato su questo server.")
    return client


def is_configured(request: Request) -> bool:
    factory = getattr(request.app.state, "bank_client_factory", None)
    if factory is not None:
        return factory() is not None
    settings: Settings = request.app.state.settings
    return bool(settings.enable_banking_app_id and settings.enable_banking_key_file)


def require_member(db: Session, family_id: uuid.UUID, user: User) -> None:
    if active_member(db, family_id, user.id) is None:
        raise ApiError("forbidden")


def bank_failure(error: BankError) -> ApiError:
    return ApiError(error.code, message=error.message)


def connection_out(row: BankConnection) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "bankName": row.bank_name,
        "country": row.country,
        "validUntil": row.valid_until,
        "accounts": row.accounts,
    }


def own_connection(db: Session, family_id: uuid.UUID, user: User, connection_id: uuid.UUID) -> BankConnection:
    row = db.get(BankConnection, connection_id)
    if row is None or row.family_id != family_id or row.user_id != user.id:
        raise ApiError("not_found")
    return row


@router.get("/status")
def bank_status(request: Request, user: CurrentUser, db: Db, family_id: FamilyQuery) -> dict[str, bool]:
    require_member(db, family_id, user)
    return {"available": True, "configured": is_configured(request), "canConfigure": False}


@router.get("/aspsps")
def aspsps(
    request: Request,
    user: CurrentUser,
    db: Db,
    family_id: FamilyQuery,
    country: Annotated[str, Query(pattern=COUNTRY)],
) -> list[dict[str, Any]]:
    require_member(db, family_id, user)
    client = bank_client(request)
    try:
        banks = client.aspsps(country)
    except BankError as error:
        raise bank_failure(error) from error
    return [
        {
            "name": b["name"],
            "country": b.get("country") or country,
            "logo": b.get("logo"),
            "maxConsentDays": consent_days(b.get("maximum_consent_validity")),
        }
        for b in banks
    ]


@router.post("/auth")
def start_auth(body: AuthIn, request: Request, user: CurrentUser, db: Db) -> dict[str, str]:
    require_member(db, body.family_id, user)
    client = bank_client(request)
    try:
        days = consent_days(None)
        for bank in client.aspsps(body.country):
            if bank["name"] == body.aspsp_name:
                days = consent_days(bank.get("maximum_consent_validity"))
        valid_until = (dt.datetime.now(dt.UTC) + dt.timedelta(days=days)).isoformat()
        state = secrets.token_urlsafe(24)
        started = client.start_auth(
            aspsp_name=body.aspsp_name,
            country=body.country,
            redirect_url=body.redirect_url,
            state=state,
            valid_until=valid_until,
        )
    except BankError as error:
        raise bank_failure(error) from error
    url = started.get("url")
    if not url:
        raise ApiError("bank_error", message="Enable Banking non ha dato l'indirizzo della banca.")
    t = now_ms()
    db.execute(delete(BankAuthState).where(BankAuthState.created_at_ms < t - STATE_TTL_MS))
    db.add(
        BankAuthState(
            state=state,
            family_id=body.family_id,
            user_id=user.id,
            aspsp_name=body.aspsp_name,
            country=body.country,
            created_at_ms=t,
        )
    )
    db.commit()
    return {"url": url}


@router.post("/sessions")
def create_session(body: SessionIn, request: Request, user: CurrentUser, db: Db) -> dict[str, Any]:
    require_member(db, body.family_id, user)
    row = db.get(BankAuthState, body.state)
    if (
        row is None
        or row.family_id != body.family_id
        or row.user_id != user.id
        or row.created_at_ms < now_ms() - STATE_TTL_MS
    ):
        raise ApiError("forbidden", message="Richiesta di collegamento non riconosciuta o scaduta.")
    client = bank_client(request)
    try:
        session = summarize_session(client.create_session(body.code))
    except BankError as error:
        raise bank_failure(error) from error
    if not session["sessionId"]:
        raise ApiError("bank_error", message="Enable Banking non ha creato la sessione.")
    connection = BankConnection(
        id=uuid.uuid4(),
        family_id=body.family_id,
        user_id=user.id,
        session_id=session["sessionId"],
        bank_name=row.aspsp_name,
        country=row.country,
        valid_until=session["validUntil"],
        accounts=session["accounts"],
        created_at_ms=now_ms(),
    )
    db.delete(row)
    db.add(connection)
    db.commit()
    return connection_out(connection)


@router.get("/connections")
def connections(user: CurrentUser, db: Db, family_id: FamilyQuery) -> list[dict[str, Any]]:
    require_member(db, family_id, user)
    rows = db.scalars(
        select(BankConnection)
        .where(BankConnection.family_id == family_id, BankConnection.user_id == user.id)
        .order_by(BankConnection.created_at_ms)
    )
    return [connection_out(r) for r in rows]


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: uuid.UUID, request: Request, user: CurrentUser, db: Db, family_id: FamilyQuery
) -> Response:
    require_member(db, family_id, user)
    row = own_connection(db, family_id, user, connection_id)
    # Sessione già scaduta o chiave cambiata: si toglie comunque il collegamento locale.
    with contextlib.suppress(BankError, ApiError):
        bank_client(request).delete_session(row.session_id)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/transactions")
def transactions(
    request: Request,
    user: CurrentUser,
    db: Db,
    family_id: FamilyQuery,
    connection_id: Annotated[uuid.UUID, Query(alias="connectionId")],
    account_uid: Annotated[str, Query(alias="accountUid", min_length=1, max_length=200)],
    date_from: Annotated[str, Query(alias="dateFrom", pattern=ISO_DAY)],
    date_to: Annotated[str, Query(alias="dateTo", pattern=ISO_DAY)],
) -> dict[str, Any]:
    require_member(db, family_id, user)
    row = own_connection(db, family_id, user, connection_id)
    if account_uid not in {a.get("uid") for a in row.accounts}:
        raise ApiError("not_found")
    if row.valid_until and row.valid_until < dt.datetime.now(dt.UTC).isoformat():
        raise ApiError(
            "consent_expired", message="Il consenso alla banca è scaduto: collega di nuovo la banca."
        )
    client = bank_client(request)
    try:
        return {"transactions": client.transactions(account_uid, date_from, date_to)}
    except BankError as error:
        raise bank_failure(error) from error
