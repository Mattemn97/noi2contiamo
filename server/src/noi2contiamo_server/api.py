"""Route REST sotto `/api/v1` (spec 0002, API surface) per il filo base (feature 5)."""

import base64
import secrets
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import store
from .errors import ApiError, conflict, invalid, issues_of
from .models import Category, Family, Invite, Member, User
from .schemas import (
    AcceptInvite,
    CategoryDoc,
    Commit,
    CreatedFamily,
    CreateFamily,
    Credentials,
    FamilyDoc,
    FamilySummary,
    InviteToken,
    NewInvite,
    Page,
    PutOp,
    Registration,
    SessionOut,
    SplitSpec,
    UserOut,
)
from .scope import active_member
from .security import (
    current_user,
    end_session,
    ensure_csrf_cookie,
    get_db,
    hash_password,
    now_ms,
    optional_user,
    sha256,
    start_session,
    verify_password,
)

INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
MAX_COMMIT_OPS = 500

router = APIRouter(prefix="/api/v1")
Db = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user)]


def member_of(db: Session, family_id: uuid.UUID, user: User) -> Member:
    """La dipendenza comune dell'isolamento: chi non è membro attivo riceve 404 (AC-5)."""
    member = active_member(db, family_id, user.id)
    if member is None:
        raise ApiError("not_found")
    return member


def user_out(user: User) -> UserOut:
    return UserOut(id=str(user.id), email=user.email)


# ---- Accesso ------------------------------------------------------------------------------


@router.get("/auth/session", response_model=SessionOut)
def session_info(
    request: Request, response: Response, user: Annotated[User | None, Depends(optional_user)]
) -> SessionOut:
    """Utente corrente (o null) e token CSRF da ripetere in `X-CSRF-Token`."""
    token = ensure_csrf_cookie(request, response)
    return SessionOut(user=user_out(user) if user else None, csrf_token=token)


@router.post("/auth/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: Registration, request: Request, response: Response, db: Db) -> UserOut:
    if db.scalars(select(User).where(User.email == body.email)).first() is not None:
        raise conflict("duplicate")
    user = User(
        id=uuid.uuid4(),
        email=body.email,
        display_name=body.display_name or body.email.split("@")[0][:60],
        password_hash=hash_password(body.password),
        created_at_ms=now_ms(),
    )
    db.add(user)
    db.flush()
    start_session(db, user, request, response)
    db.commit()
    return user_out(user)


@router.post("/auth/login", response_model=UserOut)
def login(body: Credentials, request: Request, response: Response, db: Db) -> UserOut:
    user = db.scalars(select(User).where(User.email == body.email)).first()
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise ApiError("unauthenticated", message="credenziali non valide")
    start_session(db, user, request, response)
    db.commit()
    return user_out(user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Db) -> None:
    end_session(db, request, response)
    db.commit()


# ---- Famiglie -----------------------------------------------------------------------------


def family_doc(family: Family) -> FamilyDoc:
    return FamilyDoc(
        id=str(family.id),
        name=family.name,
        currency=family.currency,
        default_split=family.default_split,  # type: ignore[arg-type]
        schema_version=family.schema_version,
        created_by_user_id=family.created_by_user_id,
        created_at_ms=family.created_at_ms,
        created_by_member_id=str(family.created_by_member_id),
        updated_at_ms=family.updated_at_ms,
        updated_by_member_id=str(family.updated_by_member_id),
    )


@router.get("/families", response_model=list[FamilySummary])
def my_families(user: CurrentUser, db: Db) -> list[FamilySummary]:
    rows = db.execute(
        select(Family, Member)
        .join(Member, Member.family_id == Family.id)
        .where(Member.user_id == user.id, Member.left_at_ms.is_(None))
        .order_by(Family.id)
    ).all()
    return [FamilySummary(family=family_doc(f), member_id=str(m.id), role=m.role) for f, m in rows]  # type: ignore[arg-type]


@router.post("/families", response_model=CreatedFamily, status_code=status.HTTP_201_CREATED)
def create_family(body: CreateFamily, user: CurrentUser, db: Db) -> CreatedFamily:
    """Atomico: famiglia, membro proprietario e categorie iniziali in una sola transazione (AC-7)."""
    family_id = uuid.UUID(body.family.id)
    owner_id = uuid.UUID(body.owner_member.id)
    if db.get(Family, family_id) is not None:
        raise conflict("duplicate")
    split = body.family.default_split
    if split is not None and set(split.shares) != {body.owner_member.id}:
        raise invalid("la divisione iniziale vale solo per il proprietario", "family.defaultSplit")
    categories: list[CategoryDoc] = []
    for index, raw in enumerate(body.defaults.categories):
        try:
            categories.append(CategoryDoc.model_validate(raw))
        except ValidationError as error:
            issues = [{**i, "path": f"defaults.categories.{index}.{i['path']}"} for i in issues_of(error)]
            raise ApiError("invalid", issues=issues) from error

    t = now_ms()
    audit = {
        "created_at_ms": t,
        "created_by_member_id": owner_id,
        "updated_at_ms": t,
        "updated_by_member_id": owner_id,
    }
    db.add(
        Family(
            id=family_id,
            name=body.family.name,
            currency=body.family.currency,
            default_split=split.model_dump()
            if split
            else {"kind": "bp", "shares": {body.owner_member.id: 10000}},
            schema_version=body.family.schema_version,
            created_by_user_id=str(user.id),
            **audit,
        )
    )
    db.flush()
    owner = Member(
        id=owner_id,
        family_id=family_id,
        display_name=body.owner_member.display_name,
        user_id=user.id,
        role="owner",
        color=body.owner_member.color,
        joined_at_ms=t,
        left_at_ms=None,
        **audit,
    )
    db.add(owner)
    db.flush()
    for category in categories:
        values = store.row_values(Category, category)
        db.add(Category(**(values | audit), family_id=family_id))
    db.commit()
    return CreatedFamily(family_id=str(family_id))


@router.put("/families/{family_id}/default-split", status_code=status.HTTP_204_NO_CONTENT)
def set_default_split(family_id: uuid.UUID, body: SplitSpec, user: CurrentUser, db: Db) -> None:
    """Divisione predefinita della famiglia (spec 0004, AC-7): ogni membro attivo, chiavi = membri attivi."""
    me = member_of(db, family_id, user)
    active = {
        str(m)
        for m in db.scalars(
            select(Member.id).where(Member.family_id == family_id, Member.left_at_ms.is_(None))
        )
    }
    strangers = [m for m in body.shares if m not in active]
    if strangers:
        raise invalid(f"{strangers[0]} non è un membro attivo della famiglia", "defaultSplit")
    family = db.get(Family, family_id)
    if family is None:
        raise ApiError("not_found")
    family.default_split = body.model_dump()
    family.updated_at_ms = now_ms()
    family.updated_by_member_id = me.id
    db.commit()


# ---- Inviti e uscita ----------------------------------------------------------------------


def invite_token() -> str:
    """128 bit casuali in base32 minuscolo (26 caratteri): mai un UUIDv7, che si indovina dal tempo."""
    return base64.b32encode(secrets.token_bytes(16)).decode().rstrip("=").lower()


@router.post("/families/{family_id}/invites", response_model=InviteToken, status_code=status.HTTP_201_CREATED)
def create_invite(family_id: uuid.UUID, body: NewInvite, user: CurrentUser, db: Db) -> InviteToken:
    me = member_of(db, family_id, user)
    if me.role != "owner":
        raise ApiError("forbidden")
    if body.member_id is not None:
        target = db.scalars(
            select(Member).where(Member.family_id == family_id, Member.id == uuid.UUID(body.member_id))
        ).one_or_none()
        if target is None or target.user_id is not None:
            raise invalid("serve un membro senza account", "memberId")
    token = invite_token()
    t = now_ms()
    db.add(
        Invite(
            id=uuid.UUID(body.id),
            family_id=family_id,
            role=body.role,
            member_id=uuid.UUID(body.member_id) if body.member_id else None,
            token_hash=sha256(token),
            expires_at_ms=body.expires_at_ms if body.expires_at_ms is not None else t + INVITE_TTL_MS,
            created_at_ms=t,
            created_by_member_id=me.id,
            updated_at_ms=t,
            updated_by_member_id=me.id,
        )
    )
    db.commit()
    return InviteToken(token=token)


@router.post("/invites/accept", response_model=CreatedFamily)
def accept_invite(body: AcceptInvite, user: CurrentUser, db: Db) -> CreatedFamily:
    invite = db.scalars(select(Invite).where(Invite.token_hash == sha256(body.token))).one_or_none()
    if invite is None:
        raise ApiError("not_found")
    if invite.revoked_at_ms is not None:
        raise ApiError("revoked")
    if invite.used_at_ms is not None:
        raise ApiError("used")
    t = now_ms()
    if invite.expires_at_ms <= t:
        raise ApiError("expired")
    if active_member(db, invite.family_id, user.id) is not None:
        raise conflict("already_member")
    # Chi era già uscito rientra con lo stesso membro (un account ha al massimo un membro per famiglia).
    former = db.scalars(
        select(Member).where(Member.family_id == invite.family_id, Member.user_id == user.id)
    ).one_or_none()
    placeholder = (
        db.scalars(
            select(Member).where(Member.family_id == invite.family_id, Member.id == invite.member_id)
        ).one_or_none()
        if invite.member_id
        else None
    )
    if former is not None:
        former.left_at_ms = None
        former.role = invite.role
        former.joined_at_ms = t
        former.updated_at_ms = t
        former.updated_by_member_id = former.id
        member_id = former.id
    elif placeholder is not None:
        if placeholder.user_id is not None:
            raise ApiError("used")
        placeholder.user_id = user.id
        placeholder.left_at_ms = None
        placeholder.updated_at_ms = t
        placeholder.updated_by_member_id = placeholder.id
        member_id = placeholder.id
    else:
        member_id = uuid.uuid7() if hasattr(uuid, "uuid7") else _uuid7()
        db.add(
            Member(
                id=member_id,
                family_id=invite.family_id,
                display_name=body.display_name,
                user_id=user.id,
                role=invite.role,
                joined_at_ms=t,
                created_at_ms=t,
                created_by_member_id=member_id,
                updated_at_ms=t,
                updated_by_member_id=member_id,
            )
        )
    invite.used_at_ms = t
    invite.used_by_user_id = user.id
    invite.updated_at_ms = t
    invite.updated_by_member_id = member_id
    db.commit()
    return CreatedFamily(family_id=str(invite.family_id))


def _uuid7() -> uuid.UUID:
    """UUIDv7 (RFC 9562) per Python < 3.14: 48 bit di millisecondi, poi casuale."""
    value = (now_ms() & ((1 << 48) - 1)) << 80 | secrets.randbits(80)
    value = (value & ~(0xF << 76)) | (0x7 << 76)
    value = (value & ~(0x3 << 62)) | (0x2 << 62)
    return uuid.UUID(int=value)


@router.post("/families/{family_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_family(family_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    me = member_of(db, family_id, user)
    if me.role == "owner":
        owners = db.scalar(
            select(func.count())
            .select_from(Member)
            .where(Member.family_id == family_id, Member.role == "owner", Member.left_at_ms.is_(None))
        )
        if (owners or 0) <= 1:
            raise conflict("last_owner")
    me.left_at_ms = now_ms()
    me.updated_at_ms = me.left_at_ms
    me.updated_by_member_id = me.id
    db.commit()


# ---- Documenti di famiglia ----------------------------------------------------------------


@router.post("/families/{family_id}/commit", status_code=status.HTTP_204_NO_CONTENT)
def commit(family_id: uuid.UUID, body: Commit, user: CurrentUser, db: Db) -> None:
    """Atomico: o tutte le operazioni o nessuna (una sola transazione SQL)."""
    me = member_of(db, family_id, user)
    if len(body.ops) > MAX_COMMIT_OPS:
        raise invalid("massimo 500 operazioni", "ops")
    for op in body.ops:
        if isinstance(op, PutOp):
            store.put(db, op.collection, me, op.doc)
        else:
            store.remove(db, op.collection, me, op.id)
    db.commit()


@router.get("/families/{family_id}/{collection}", response_model=Page)
def list_collection(
    family_id: uuid.UUID,
    collection: str,
    user: CurrentUser,
    db: Db,
    where: Annotated[str | None, Query(description="JSON: uguaglianza sui campi indicizzati")] = None,
    order_by: Annotated[str | None, Query(alias="orderBy")] = None,
    limit: Annotated[int, Query()] = store.MAX_LIMIT,
    after: Annotated[str | None, Query(description="JSON: cursore della pagina precedente")] = None,
    date_from: Annotated[str | None, Query(alias="dateFrom")] = None,
    date_to: Annotated[str | None, Query(alias="dateTo")] = None,
    scope: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    me = member_of(db, family_id, user)
    return store.list_docs(
        db,
        collection,
        me,
        where=where,
        order_by=order_by,
        limit=limit,
        after=after,
        date_from=date_from,
        date_to=date_to,
        scope=scope,
    )


@router.get("/families/{family_id}/{collection}/{doc_id}")
def get_doc(family_id: uuid.UUID, collection: str, doc_id: str, user: CurrentUser, db: Db) -> dict[str, Any]:
    me = member_of(db, family_id, user)
    return store.get(db, collection, me, doc_id)


@router.put("/families/{family_id}/{collection}/{doc_id}")
def put_doc(
    family_id: uuid.UUID, collection: str, doc_id: str, doc: dict[str, Any], user: CurrentUser, db: Db
) -> dict[str, Any]:
    me = member_of(db, family_id, user)
    if doc.get("id") != doc_id:
        raise invalid("l'id nel percorso e nel documento devono coincidere", "id")
    saved = store.put(db, collection, me, doc)
    db.commit()
    return saved


@router.delete("/families/{family_id}/{collection}/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doc(family_id: uuid.UUID, collection: str, doc_id: str, user: CurrentUser, db: Db) -> None:
    me = member_of(db, family_id, user)
    store.remove(db, collection, me, doc_id)
    db.commit()
