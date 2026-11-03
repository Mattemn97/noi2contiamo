"""Le operazioni sui documenti di famiglia: lettura, scrittura, cancellazione, elenco (spec 0002).

Ogni funzione riceve il membro attivo (già verificato da `member_of`) e lavora solo dentro
`member.family_id`, con il filtro di visibilità su conti e movimenti. La logica di dominio resta in
`packages/core`: qui ci sono forma (Pydantic), vincoli (SQL) e permessi.
"""

import json
import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError
from pydantic.alias_generators import to_camel
from sqlalchemy import Select, and_, delete, exists, inspect, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import Uuid

from .errors import ApiError, conflict, invalid, issues_of
from .models import (
    Account,
    Base,
    Category,
    ImportBatch,
    ImportProfile,
    Invite,
    Member,
    MemberSettings,
    Payee,
    Recurrence,
    RecurrenceDismissal,
    Reminder,
    Rule,
    Transaction,
    TransactionFingerprint,
)
from .schemas import (
    AccountDoc,
    CategoryDoc,
    Doc,
    ImportBatchDoc,
    ImportProfileDoc,
    InviteDoc,
    MemberDoc,
    MemberSettingsDoc,
    PayeeDoc,
    RecurrenceDismissalDoc,
    RecurrenceDoc,
    ReminderDoc,
    RuleDoc,
    TransactionDoc,
    normalize,
)
from .scope import PERSONAL, scoped
from .security import now_ms

MAX_LIMIT = 500


@dataclass(frozen=True)
class CollectionDef:
    model: type[Base]
    schema: type[Doc]
    indexed: tuple[str, ...]
    order_by: tuple[str, ...]
    has_date: bool = False
    scoped: bool = False


# Le collezioni del filo base (feature 5), dei destinatari (feature 7), dell'import (feature 11)
# e delle regole (feature 12).
# Le altre arrivano con le loro slice.
COLLECTIONS: dict[str, CollectionDef] = {
    "members": CollectionDef(Member, MemberDoc, ("userId", "role"), ("id_asc",)),
    "invites": CollectionDef(Invite, InviteDoc, ("memberId",), ("id_asc",)),
    "accounts": CollectionDef(
        Account, AccountDoc, ("ownerMemberId", "kind"), ("order_asc", "id_asc"), scoped=True
    ),
    "categories": CollectionDef(Category, CategoryDoc, ("kind", "parentId"), ("order_asc", "id_asc")),
    "payees": CollectionDef(Payee, PayeeDoc, ("normalizedName",), ("id_asc",)),
    "transactions": CollectionDef(
        Transaction,
        TransactionDoc,
        ("accountId", "recurrenceId", "importBatchId"),
        ("date_desc", "id_asc"),
        has_date=True,
        scoped=True,
    ),
    "rules": CollectionDef(Rule, RuleDoc, ("enabled",), ("order_asc", "id_asc")),
    "recurrences": CollectionDef(Recurrence, RecurrenceDoc, ("accountId",), ("id_asc",)),
    "recurrenceDismissals": CollectionDef(RecurrenceDismissal, RecurrenceDismissalDoc, (), ("id_asc",)),
    "importProfiles": CollectionDef(ImportProfile, ImportProfileDoc, ("headerSignature",), ("id_asc",)),
    "importBatches": CollectionDef(ImportBatch, ImportBatchDoc, ("accountId",), ("id_asc",)),
    "memberSettings": CollectionDef(MemberSettings, MemberSettingsDoc, (), ("id_asc",)),
    "reminders": CollectionDef(Reminder, ReminderDoc, ("status", "kind"), ("id_asc",)),
}


def collection_def(name: str) -> CollectionDef:
    found = COLLECTIONS.get(name)
    if found is None:
        raise ApiError("not_found")
    return found


# ---- Conversione documento <-> riga ------------------------------------------------------


def _uuid_columns(model: type[Base]) -> set[str]:
    return {c.key for c in inspect(model).columns if isinstance(c.type, Uuid)}


def _to_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as error:
        raise ApiError("invalid_query", message=f"id non valido: {value}") from error


def row_values(model: type[Base], doc: Doc) -> dict[str, Any]:
    """Valori delle colonne dal documento validato (gli oggetti annidati restano in camelCase)."""
    columns = {c.key for c in inspect(model).columns}
    uuids = _uuid_columns(model)
    values: dict[str, Any] = {}
    for name in type(doc).model_fields:
        if name not in columns or name == "family_id":
            continue
        value = getattr(doc, name)
        if hasattr(value, "model_dump"):
            value = value.model_dump(exclude_none=True)
        if name in uuids and isinstance(value, str):
            try:
                value = uuid.UUID(value)
            except ValueError as error:
                raise invalid("id non valido", to_camel(name)) from error
        values[name] = value
    return values


def doc_of(db: Session, collection: str, row: Base) -> dict[str, Any]:
    schema = COLLECTIONS[collection].schema
    out: dict[str, Any] = {}
    for name in schema.model_fields:
        if name == "import_fingerprints":
            continue
        value = getattr(row, name)
        out[to_camel(name)] = str(value) if isinstance(value, uuid.UUID) else value
    if collection == "transactions":
        out["importFingerprints"] = sorted(
            db.scalars(
                select(TransactionFingerprint.fingerprint).where(
                    TransactionFingerprint.family_id == row.family_id,  # type: ignore[attr-defined]
                    TransactionFingerprint.transaction_id == row.id,  # type: ignore[attr-defined]
                )
            )
        )
    return out


def parse(collection: str, raw: dict[str, Any]) -> Doc:
    try:
        return COLLECTIONS[collection].schema.model_validate(raw)
    except ValidationError as error:
        raise ApiError("invalid", issues=issues_of(error)) from error


# ---- Permessi (come `canRead`/`canWrite` dell'adapter memory e le regole Firestore) --------


def _visible(collection: str, values: dict[str, Any], me: Member) -> bool:
    personal = PERSONAL.get(COLLECTIONS[collection].model)
    if personal is not None:
        return values.get(personal) == me.id
    if COLLECTIONS[collection].scoped:
        return values.get("visibility") == "shared" or values.get("owner_member_id") == me.id
    return True


def _row_dict(row: Base) -> dict[str, Any]:
    return {c.key: getattr(row, c.key) for c in inspect(type(row)).columns}


def find(db: Session, collection: str, me: Member, doc_id: str) -> Base | None:
    model: Any = COLLECTIONS[collection].model
    key: Any = doc_id
    if "id" in _uuid_columns(model):
        try:
            key = uuid.UUID(doc_id)
        except ValueError:
            return None
    return db.scalars(scoped(model, me).where(model.id == key)).one_or_none()


# ---- Invarianti che chiedono altri documenti (come `checkTransaction` di core) --------------


def _check_transaction(db: Session, me: Member, tx: TransactionDoc) -> None:
    def account(account_id: str | None) -> Account | None:
        if account_id is None:
            return None
        return db.scalars(
            select(Account).where(Account.family_id == me.family_id, Account.id == uuid.UUID(account_id))
        ).one_or_none()

    issues: list[str] = []
    acc, to_acc = account(tx.account_id), account(tx.to_account_id)
    if acc is None:
        issues.append("accountId: conto inesistente")
    if tx.type == "transfer" and tx.to_account_id is not None and to_acc is None:
        issues.append("toAccountId: conto inesistente")
    if tx.category_id is not None:
        category = db.scalars(
            select(Category).where(
                Category.family_id == me.family_id, Category.id == uuid.UUID(tx.category_id)
            )
        ).one_or_none()
        if category is None:
            issues.append("categoryId: categoria inesistente")
        elif category.kind != tx.type:
            issues.append("categoryId: la categoria deve avere lo stesso kind")
    if tx.payee_id is not None:
        payee = db.scalars(
            select(Payee).where(Payee.family_id == me.family_id, Payee.id == uuid.UUID(tx.payee_id))
        ).one_or_none()
        if payee is None:
            issues.append("payeeId: destinatario inesistente")
    member_ids = {str(m) for m in db.scalars(select(Member.id).where(Member.family_id == me.family_id))}
    referenced = list((tx.split.shares if tx.split else {}).keys())
    referenced += [tx.payer_member_id] if tx.payer_member_id else []
    if tx.settlement:
        referenced += [tx.settlement.fromMemberId, tx.settlement.toMemberId]
    issues += [f"{m} non è un membro della famiglia" for m in referenced if m not in member_ids]

    def private_of(a: Account | None) -> bool:
        return a is not None and a.visibility == "private" and str(a.owner_member_id) == tx.owner_member_id

    if tx.visibility == "private":
        if not private_of(acc):
            issues.append("visibility: privato solo su un conto privato dello stesso proprietario")
        if tx.type == "transfer" and not private_of(to_acc):
            issues.append("visibility: un giroconto è privato solo se entrambi i conti sono privati")
    elif acc is not None and acc.visibility == "private":
        if tx.type != "transfer" or (to_acc is not None and to_acc.visibility == "private"):
            issues.append("visibility: un movimento su un conto privato è privato")
    if issues:
        raise ApiError("invalid", issues=[{"path": "", "message": m} for m in issues])


def _exists(db: Session, me: Member, model: Any, doc_id: str | None) -> bool:
    if doc_id is None:
        return True
    return (
        db.scalar(select(exists().where(model.family_id == me.family_id, model.id == uuid.UUID(doc_id))))
        is True
    )


def _check_refs(db: Session, me: Member, doc: Doc) -> None:
    """Riferimenti dei documenti di import (feature 11): un id inesistente è 422, non un errore SQL."""
    refs: list[tuple[str, Any, str | None]] = []
    if isinstance(doc, TransactionDoc):
        refs += [
            ("importBatchId", ImportBatch, doc.import_batch_id),
            ("recurrenceId", Recurrence, doc.recurrence_id),
        ]
    elif isinstance(doc, ImportBatchDoc):
        refs += [("accountId", Account, doc.account_id), ("profileId", ImportProfile, doc.profile_id)]
    elif isinstance(doc, ImportProfileDoc):
        refs.append(("defaultAccountId", Account, doc.default_account_id))
    elif isinstance(doc, RecurrenceDoc):
        refs += [
            ("accountId", Account, doc.account_id),
            ("toAccountId", Account, doc.to_account_id),
            ("categoryId", Category, doc.category_id),
            ("payeeId", Payee, doc.payee_id),
        ]
        refs += [("split", Member, x) for x in (doc.split.shares if doc.split else {})]
    elif isinstance(doc, RecurrenceDismissalDoc):
        refs.append(("dismissedByMemberId", Member, doc.dismissed_by_member_id))
    elif isinstance(doc, ReminderDoc):
        refs.append(("memberId", Member, doc.member_id))
    elif isinstance(doc, MemberSettingsDoc):
        refs.append(("id", Member, doc.id))
    elif isinstance(doc, RuleDoc):
        c, a = doc.conditions, doc.actions
        refs += [("conditions.accountIds", Account, x) for x in c.accountIds or []]
        refs += [("conditions.payeeIds", Payee, x) for x in c.payeeIds or []]
        refs += [("conditions.memberIds", Member, x) for x in c.memberIds or []]
        refs += [
            ("actions.categoryId", Category, a.categoryId),
            ("actions.payeeId", Payee, a.payeeId),
            ("actions.transferAccountId", Account, a.transferAccountId),
        ]
        refs += [("actions.split", Member, x) for x in (a.split.shares if a.split else {})]
    issues = [
        {"path": path, "message": "documento inesistente"}
        for path, model, ref in refs
        if not _exists(db, me, model, ref)
    ]
    if issues:
        raise ApiError("invalid", issues=issues)


def _check_catalog(db: Session, me: Member, collection: str, values: dict[str, Any]) -> None:
    """Nomi unici e un solo livello di categorie (come `nameTaken` e `checkCategory` di core, feature 7)."""
    model: Any = COLLECTIONS[collection].model
    rows = db.scalars(select(model).where(model.family_id == me.family_id))
    others = [r for r in rows if r.id != values["id"]]
    key = normalize(values["name"])
    if collection == "accounts":
        clash = values["archived_at_ms"] is None and any(
            r.archived_at_ms is None and normalize(r.name) == key for r in others
        )
    elif collection == "categories":
        clash = any(
            r.kind == values["kind"] and r.parent_id == values["parent_id"] and normalize(r.name) == key
            for r in others
        )
    else:
        clash = any(r.normalized_name == values["normalized_name"] for r in others)
    if clash:
        raise conflict("duplicate")
    if collection != "categories" or values["parent_id"] is None:
        return
    issues: list[str] = []
    parent = next((r for r in others if r.id == values["parent_id"]), None)
    if values["parent_id"] == values["id"]:
        issues.append("parentId: una categoria non può contenere sé stessa")
    elif parent is None:
        issues.append("parentId: categoria genitore inesistente")
    else:
        if parent.parent_id is not None:
            issues.append("parentId: le categorie hanno un solo livello")
        if parent.kind != values["kind"]:
            issues.append("parentId: il genitore deve avere lo stesso tipo")
    if any(r.parent_id == values["id"] for r in others):
        issues.append("parentId: una categoria con sottocategorie non può diventare sottocategoria")
    if issues:
        raise ApiError("invalid", issues=[{"path": "parentId", "message": m} for m in issues])


def _active_owners(db: Session, family_id: uuid.UUID) -> int:
    return len(
        db.scalars(
            select(Member.id).where(
                Member.family_id == family_id, Member.role == "owner", Member.left_at_ms.is_(None)
            )
        ).all()
    )


# ---- Operazioni ---------------------------------------------------------------------------


def put(db: Session, collection: str, me: Member, raw: dict[str, Any]) -> dict[str, Any]:
    cdef = collection_def(collection)
    doc = parse(collection, raw)
    model: Any = cdef.model
    values = row_values(model, doc)
    key = values["id"]
    prev = db.scalars(select(model).where(model.family_id == me.family_id, model.id == key)).one_or_none()
    prev_values = _row_dict(prev) if prev is not None else None

    if prev_values is not None and not _visible(collection, prev_values, me):
        raise ApiError("not_found")
    if not _visible(collection, values, me):
        raise ApiError("forbidden")
    if collection == "invites":
        if me.role != "owner":
            raise ApiError("forbidden")
        if prev is None:
            raise invalid("gli inviti si creano con POST /families/{f}/invites")
        # Su un invito esistente si può solo revocare (feature 6): uso e scadenza non si riscrivono.
        fixed = ("role", "member_id", "expires_at_ms", "used_at_ms", "used_by_user_id")
        before = prev_values or {}
        if any(str(before.get(k)) != str(values.get(k)) for k in fixed):
            raise ApiError("forbidden")
    if collection == "members":
        _check_member_write(me, values, prev_values)
    if isinstance(doc, TransactionDoc):
        _check_transaction(db, me, doc)
    _check_refs(db, me, doc)
    if collection in ("accounts", "categories", "payees"):
        _check_catalog(db, me, collection, values)

    if collection == "reminders":
        _guard_reminder(db, me, values, prev)

    t = now_ms()
    values |= {
        "family_id": me.family_id,
        "created_at_ms": prev_values["created_at_ms"] if prev_values else t,
        "created_by_member_id": prev_values["created_by_member_id"] if prev_values else me.id,
        "updated_at_ms": t,
        "updated_by_member_id": me.id,
    }
    if prev is None:
        row = model(**values)
        db.add(row)
    else:
        for name, value in values.items():
            setattr(prev, name, value)
        row = prev
    db.flush()

    if isinstance(doc, TransactionDoc):
        _write_fingerprints(db, me.family_id, row.id, doc.import_fingerprints)
    if collection == "members" and _active_owners(db, me.family_id) == 0:
        raise conflict("last_owner")
    return doc_of(db, collection, row)


def _guard_reminder(db: Session, me: Member, values: dict[str, Any], prev: Any) -> None:
    """Il server decide l'invio (feature 19): il client non segna "sent" né riapre un promemoria inviato."""
    clash = db.scalar(
        select(
            exists().where(
                Reminder.family_id == me.family_id,
                Reminder.dedup_key == values["dedup_key"],
                Reminder.id != values["id"],
            )
        )
    )
    if clash:
        raise conflict("duplicate")
    was_sent = prev is not None and prev.status == "sent"
    values["status"] = "sent" if was_sent else ("pending" if values["status"] == "sent" else values["status"])
    values["sent_at_ms"] = prev.sent_at_ms if was_sent else None


def _check_member_write(me: Member, values: dict[str, Any], prev: dict[str, Any] | None) -> None:
    # L'account di login si collega solo con un invito (o reclamando un membro importato).
    if values.get("user_id") is not None and (prev is None or prev["user_id"] != values["user_id"]):
        raise ApiError("forbidden")
    if me.role == "owner":
        return
    unchanged = prev is not None and all(
        str(prev[k]) == str(values[k]) for k in ("role", "user_id", "left_at_ms")
    )
    if prev is None or values["id"] != me.id or not unchanged:
        raise ApiError("forbidden")


def _write_fingerprints(db: Session, family_id: uuid.UUID, tx_id: uuid.UUID, fingerprints: list[str]) -> None:
    db.execute(
        delete(TransactionFingerprint).where(
            TransactionFingerprint.family_id == family_id, TransactionFingerprint.transaction_id == tx_id
        )
    )
    for fingerprint in fingerprints:
        taken = db.scalar(
            select(
                exists().where(
                    TransactionFingerprint.family_id == family_id,
                    TransactionFingerprint.fingerprint == fingerprint,
                )
            )
        )
        if taken:
            raise conflict("duplicate_fingerprint")
        db.add(TransactionFingerprint(family_id=family_id, fingerprint=fingerprint, transaction_id=tx_id))
    db.flush()


def get(db: Session, collection: str, me: Member, doc_id: str) -> dict[str, Any]:
    collection_def(collection)
    row = find(db, collection, me, doc_id)
    if row is None:
        raise ApiError("not_found")
    return doc_of(db, collection, row)


def remove(db: Session, collection: str, me: Member, doc_id: str) -> None:
    collection_def(collection)
    row: Any = find(db, collection, me, doc_id)
    if row is None:
        raise ApiError("not_found")
    if collection == "members" or (collection == "invites" and me.role != "owner"):
        raise ApiError("forbidden")
    in_family = Transaction.family_id == me.family_id
    used = False
    if collection == "accounts":
        used = bool(
            db.scalar(
                select(
                    exists().where(
                        in_family, or_(Transaction.account_id == row.id, Transaction.to_account_id == row.id)
                    )
                )
            )
        )
    elif collection == "payees":
        used = bool(db.scalar(select(exists().where(in_family, Transaction.payee_id == row.id))))
    elif collection == "importBatches":
        used = bool(db.scalar(select(exists().where(in_family, Transaction.import_batch_id == row.id))))
    elif collection == "recurrences":
        used = bool(db.scalar(select(exists().where(in_family, Transaction.recurrence_id == row.id))))
    elif collection == "importProfiles":
        used = bool(
            db.scalar(
                select(
                    exists().where(ImportBatch.family_id == me.family_id, ImportBatch.profile_id == row.id)
                )
            )
        )
    if collection == "accounts" and not used:
        used = bool(
            db.scalar(
                select(
                    exists().where(ImportBatch.family_id == me.family_id, ImportBatch.account_id == row.id)
                )
            )
            or db.scalar(
                select(
                    exists().where(
                        ImportProfile.family_id == me.family_id, ImportProfile.default_account_id == row.id
                    )
                )
            )
        )
    elif collection == "categories":
        used = bool(
            db.scalar(select(exists().where(in_family, Transaction.category_id == row.id)))
            or db.scalar(
                select(exists().where(Category.family_id == me.family_id, Category.parent_id == row.id))
            )
        )
    if used:
        raise conflict("in_use")
    db.delete(row)
    db.flush()


def _parse_json(value: str | None, what: str) -> Any:
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as error:
        raise ApiError("invalid_query", message=f"{what} non è JSON") from error


def list_docs(
    db: Session,
    collection: str,
    me: Member,
    *,
    where: str | None,
    order_by: str | None,
    limit: int,
    after: str | None,
    date_from: str | None,
    date_to: str | None,
    scope: str | None,
) -> dict[str, Any]:
    cdef = collection_def(collection)
    model: Any = cdef.model
    order = order_by or cdef.order_by[0]
    if not 1 <= limit <= MAX_LIMIT:
        raise ApiError("invalid_query", message="limit fuori da 1..500")
    if order not in cdef.order_by:
        raise ApiError("invalid_query", message=f"orderBy {order} non ammesso")
    if not cdef.has_date and (date_from is not None or date_to is not None):
        raise ApiError("invalid_query", message="niente date qui")
    if not cdef.scoped and scope is not None:
        raise ApiError("invalid_query", message="scope solo per conti e movimenti")
    if scope not in (None, "shared", "mine"):
        raise ApiError("invalid_query", message="scope non valido")

    stmt: Select[Any] = scoped(model, me)
    uuids = _uuid_columns(model)
    filters = _parse_json(where, "where") or {}
    if not isinstance(filters, dict):
        raise ApiError("invalid_query", message="where deve essere un oggetto")
    for field, value in filters.items():
        if field not in cdef.indexed:
            raise ApiError("invalid_query", message=f"campo {field} non indicizzato")
        column = _snake(field)
        value = _to_uuid(value) if column in uuids and isinstance(value, str) else value
        stmt = stmt.where(
            getattr(model, column).is_(None) if value is None else getattr(model, column) == value
        )
    if scope == "shared":
        stmt = stmt.where(model.visibility == "shared")
    elif scope == "mine":
        stmt = stmt.where(model.visibility == "private", model.owner_member_id == me.id)
    if date_from is not None:
        stmt = stmt.where(model.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(model.date <= date_to)

    cursor = _parse_json(after, "after")
    if cursor is not None:
        if not isinstance(cursor, dict) or not isinstance(cursor.get("id"), str):
            raise ApiError("invalid_query", message="cursore non valido")
        cid: Any = _to_uuid(cursor["id"]) if "id" in uuids else cursor["id"]
        if order == "date_desc":
            d = str(cursor.get("date", ""))
            stmt = stmt.where(or_(model.date < d, and_(model.date == d, model.id < cid)))
        elif order == "order_asc":
            o = int(cursor.get("order", 0))
            stmt = stmt.where(or_(model.order > o, and_(model.order == o, model.id > cid)))
        else:
            stmt = stmt.where(model.id > cid)

    if order == "date_desc":
        stmt = stmt.order_by(model.date.desc(), model.id.desc())
    elif order == "order_asc":
        stmt = stmt.order_by(model.order.asc(), model.id.asc())
    else:
        stmt = stmt.order_by(model.id.asc())

    rows = db.scalars(stmt.limit(limit + 1)).all()
    page = rows[:limit]
    next_cursor: dict[str, Any] | None = None
    if len(rows) > limit:
        last = page[-1]
        next_cursor = {"id": str(last.id)}
        if order == "date_desc":
            next_cursor["date"] = last.date
        elif order == "order_asc":
            next_cursor["order"] = last.order
    return {"docs": [doc_of(db, collection, r) for r in page], "next": next_cursor}


def _snake(field: str) -> str:
    return "".join(f"_{c.lower()}" if c.isupper() else c for c in field)
