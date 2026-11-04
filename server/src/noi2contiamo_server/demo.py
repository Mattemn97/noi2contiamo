"""Dati dimostrativi: una famiglia inventata, caricata dal magazzino dati del server (solo modalità Python).

Uso: `npm run demo`. Si può rilanciare: se gli utenti demo esistono già non fa nulla.
"""

import secrets
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import store
from .db import make_engine, run_migrations
from .models import Category, Family, Member, User
from .security import hash_password, now_ms
from .settings import get_settings

DEMO_PASSWORD = "demo-password-2026"
DEMO_USERS = (
    ("giulia.demo@example.com", "Giulia", "#2f6fed"),
    ("marco.demo@example.com", "Marco", "#d9480f"),
)

INCOME_CATEGORIES = ("Stipendio", "Rimborsi / Varie")
EXPENSE_CATEGORIES = (
    "Spesa Alimentare",
    "Casa / Affitto / Mutuo",
    "Bollette / Utenze",
    "Trasporti / Auto / Moto",
    "Svago / Hobby / Uscite",
    "Salute / Farmacia",
)

# (giorni fa, tipo, centesimi, categoria, descrizione, indice di chi paga)
ROWS = (
    (85, "income", 210_000, "Stipendio", "Stipendio Giulia", 0),
    (84, "income", 190_000, "Stipendio", "Stipendio Marco", 1),
    (80, "expense", 78_000, "Casa / Affitto / Mutuo", "Affitto", 0),
    (74, "expense", 8_640, "Spesa Alimentare", "Supermercato", 0),
    (66, "expense", 9_450, "Bollette / Utenze", "Luce e gas", 1),
    (58, "expense", 4_500, "Svago / Hobby / Uscite", "Cena fuori", 1),
    (55, "expense", 6_020, "Spesa Alimentare", "Mercato", 1),
    (50, "income", 210_000, "Stipendio", "Stipendio Giulia", 0),
    (49, "income", 190_000, "Stipendio", "Stipendio Marco", 1),
    (45, "expense", 78_000, "Casa / Affitto / Mutuo", "Affitto", 0),
    (38, "expense", 5_500, "Trasporti / Auto / Moto", "Benzina", 0),
    (30, "expense", 2_390, "Salute / Farmacia", "Farmacia", 1),
    (24, "expense", 11_280, "Spesa Alimentare", "Supermercato", 0),
    (15, "income", 210_000, "Stipendio", "Stipendio Giulia", 0),
    (14, "income", 190_000, "Stipendio", "Stipendio Marco", 1),
    (10, "expense", 78_000, "Casa / Affitto / Mutuo", "Affitto", 0),
    (6, "expense", 3_800, "Svago / Hobby / Uscite", "Cinema", 1),
    (2, "expense", 7_315, "Spesa Alimentare", "Supermercato", 1),
)


def _uuid7() -> uuid.UUID:
    value = (now_ms() & ((1 << 48) - 1)) << 80 | secrets.randbits(80)
    value = (value & ~(0xF << 76)) | (0x7 << 76)
    value = (value & ~(0x3 << 62)) | (0x2 << 62)
    return uuid.UUID(int=value)


def load_demo(db: Session, today: date | None = None) -> bool:
    """Crea utenti, famiglia, conto, categorie e movimenti. Restituisce False se i dati demo ci sono già."""
    if db.scalars(select(User).where(User.email == DEMO_USERS[0][0])).first() is not None:
        return False
    today = today or date.today()
    t = now_ms()

    users = [
        User(
            id=_uuid7(),
            email=email,
            display_name=name,
            password_hash=hash_password(DEMO_PASSWORD),
            created_at_ms=t,
        )
        for email, name, _ in DEMO_USERS
    ]
    db.add_all(users)
    db.flush()

    family_id = _uuid7()
    member_ids = [_uuid7() for _ in users]
    audit = {
        "created_at_ms": t,
        "created_by_member_id": member_ids[0],
        "updated_at_ms": t,
        "updated_by_member_id": member_ids[0],
    }
    half = {"kind": "bp", "shares": {str(m): 5000 for m in member_ids}}
    db.add(
        Family(
            id=family_id,
            name="Casa Demo",
            currency="EUR",
            default_split=half,
            schema_version=1,
            created_by_user_id=str(users[0].id),
            **audit,
        )
    )
    db.flush()
    for index, (user, member_id) in enumerate(zip(users, member_ids, strict=True)):
        db.add(
            Member(
                id=member_id,
                family_id=family_id,
                display_name=DEMO_USERS[index][1],
                user_id=user.id,
                role="owner" if index == 0 else "member",
                color=DEMO_USERS[index][2],
                joined_at_ms=t,
                left_at_ms=None,
                **audit,
            )
        )
    db.flush()
    for kind, names in (("income", INCOME_CATEGORIES), ("expense", EXPENSE_CATEGORIES)):
        for position, name in enumerate(names):
            db.add(Category(id=_uuid7(), family_id=family_id, name=name, kind=kind, order=position, **audit))
    db.commit()

    me = db.scalars(select(Member).where(Member.id == member_ids[0])).one()
    categories = {
        c.name: str(c.id) for c in db.scalars(select(Category).where(Category.family_id == family_id))
    }
    account_id = str(_uuid7())
    store.put(
        db,
        "accounts",
        me,
        {
            "id": account_id,
            "name": "Conto comune",
            "kind": "checking",
            "initialBalanceCents": 150_000,
            "initialBalanceDate": (today - timedelta(days=90)).isoformat(),
        },
    )

    split = {"kind": "bp", "source": "default", "shares": {str(m): 5000 for m in member_ids}}
    for days_ago, kind, cents, category, description, payer in ROWS:
        doc: dict[str, object] = {
            "id": str(_uuid7()),
            "type": kind,
            "date": (today - timedelta(days=days_ago)).isoformat(),
            "amountCents": cents,
            "accountId": account_id,
            "categoryId": categories[category],
            "description": description,
            "split": split,
        }
        if kind == "expense":
            doc["payerMemberId"] = str(member_ids[payer])
        store.put(db, "transactions", me, doc)
    db.commit()
    return True


def main() -> None:
    settings = get_settings()
    run_migrations(settings.database_url)
    engine = make_engine(settings.database_url)
    with Session(engine) as db:
        created = load_demo(db)
    engine.dispose()
    if created:
        print("Dati demo caricati. Accedi con una di queste email:")
        for email, name, _ in DEMO_USERS:
            print(f"  {name}: {email}")
        print(f"Password (uguale per entrambi): {DEMO_PASSWORD}")
    else:
        print("I dati demo ci sono già: niente da fare.")


if __name__ == "__main__":
    main()
