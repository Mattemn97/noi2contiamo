"""Isolamento per famiglia (spec 0002, AC-5).

Ogni query sui dati passa da qui: si ricava il membro attivo dell'utente nella famiglia (altrimenti
404, per non rivelare che la famiglia esiste) e si aggiungono sempre `family_id = :f` e, su conti e
movimenti, il filtro di visibilità `visibility = 'shared' OR owner_member_id = :me`.
"""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from .models import Account, Base, Member, Transaction

# Collezioni con documenti privati: il filtro di visibilità vale sempre.
VISIBILITY_SCOPED: tuple[type[Base], ...] = (Account, Transaction)


def active_member(session: Session, family_id: uuid.UUID, user_id: uuid.UUID) -> Member | None:
    return session.scalars(
        select(Member).where(
            Member.family_id == family_id, Member.user_id == user_id, Member.left_at_ms.is_(None)
        )
    ).one_or_none()


def require_member(session: Session, family_id: uuid.UUID, user_id: uuid.UUID) -> Member:
    """Base della dipendenza FastAPI comune: chi non è membro riceve 404."""
    member = active_member(session, family_id, user_id)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    return member


def scoped[M: Base](model: type[M], member: Member) -> Select[tuple[M]]:
    """`SELECT` sulla collezione già ristretto alla famiglia e a ciò che il membro può vedere."""
    columns: Any = model
    stmt = select(model).where(columns.family_id == member.family_id)
    if model in VISIBILITY_SCOPED:
        stmt = stmt.where(or_(columns.visibility == "shared", columns.owner_member_id == member.id))
    return stmt
