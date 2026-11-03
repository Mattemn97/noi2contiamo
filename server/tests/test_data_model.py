"""Migrazione 0002, vincoli SQL e isolamento per famiglia (spec 0002, AC-5, AC-6)."""

import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi import HTTPException
from sqlalchemy import Engine, delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from noi2contiamo_server.db import SERVER_ROOT, make_engine, run_migrations
from noi2contiamo_server.models import (
    Account,
    Base,
    Category,
    Family,
    Member,
    Payee,
    Transaction,
    TransactionFingerprint,
    User,
)
from noi2contiamo_server.scope import active_member, require_member, scoped

TABLES = {
    "users",
    "sessions",
    "families",
    "members",
    "invites",
    "accounts",
    "categories",
    "payees",
    "transactions",
    "transaction_fingerprints",
    "rules",
    "import_profiles",
    "import_batches",
    "recurrences",
    "recurrence_dismissals",
    "member_settings",
    "reminders",
}


@pytest.fixture
def url(tmp_path: Path) -> str:
    return f"sqlite:///{(tmp_path / 'test.db').as_posix()}"


@pytest.fixture
def engine(url: str) -> Iterator[Engine]:
    run_migrations(url)
    engine = make_engine(url)
    yield engine
    engine.dispose()


def audit(member_id: uuid.UUID) -> dict[str, Any]:
    return {
        "created_at_ms": 1,
        "created_by_member_id": member_id,
        "updated_at_ms": 1,
        "updated_by_member_id": member_id,
    }


class World:
    """Due famiglie: in F1 Anna (proprietaria) e Bruno, in F2 Carla."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.anna, self.bruno, self.carla = (self.user(n) for n in ("anna", "bruno", "carla"))
        self.f1, self.m_anna = self.family(self.anna)
        self.f2, self.m_carla = self.family(self.carla)
        self.m_bruno = self.member(self.f1, self.bruno, "member")
        self.shared = self.account(self.f1)
        self.private = self.account(self.f1, owner=self.m_anna)
        self.other_family_account = self.account(self.f2, by=self.m_carla)
        session.commit()

    def user(self, name: str) -> uuid.UUID:
        user = User(
            id=uuid.uuid4(),
            email=f"{name}@example.com",
            display_name=name,
            password_hash="x",
            created_at_ms=1,
        )
        self.session.add(user)
        return user.id

    def family(self, owner: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
        family_id, member_id = uuid.uuid4(), uuid.uuid4()
        self.session.add(
            Family(
                id=family_id,
                name="Casa",
                default_split={"kind": "bp", "shares": {str(member_id): 10000}},
                created_by_user_id=str(owner),
                **audit(member_id),
            )
        )
        self.session.flush()
        self.session.add(
            Member(
                id=member_id,
                family_id=family_id,
                display_name="Owner",
                user_id=owner,
                role="owner",
                joined_at_ms=1,
                **audit(member_id),
            )
        )
        self.session.flush()
        return family_id, member_id

    def member(self, family_id: uuid.UUID, user_id: uuid.UUID, role: str) -> uuid.UUID:
        member_id = uuid.uuid4()
        self.session.add(
            Member(
                id=member_id,
                family_id=family_id,
                display_name="Membro",
                user_id=user_id,
                role=role,
                joined_at_ms=1,
                **audit(member_id),
            )
        )
        self.session.flush()
        return member_id

    def account(
        self, family_id: uuid.UUID, owner: uuid.UUID | None = None, by: uuid.UUID | None = None
    ) -> uuid.UUID:
        account_id = uuid.uuid4()
        self.session.add(
            Account(
                id=account_id,
                family_id=family_id,
                name="Conto",
                kind="checking",
                owner_member_id=owner,
                visibility="private" if owner else "shared",
                initial_balance_date="2026-01-01",
                **audit(by or self.m_anna),
            )
        )
        self.session.flush()
        return account_id

    def tx(self, **overrides: Any) -> Transaction:
        values: dict[str, Any] = {
            "id": uuid.uuid4(),
            "family_id": self.f1,
            "type": "expense",
            "date": "2026-11-03",
            "amount_cents": 10001,
            "account_id": self.shared,
            "split": {"kind": "bp", "source": "default", "shares": {str(self.m_anna): 10000}},
            "provenance": {"category": "manual", "payee": "manual", "split": "manual"},
            **audit(self.m_anna),
        }
        values.update(overrides)
        return Transaction(**values)

    def add(self, *rows: Base) -> None:
        self.session.add_all(rows)
        self.session.commit()


@pytest.fixture
def world(engine: Engine) -> Iterator[World]:
    with Session(engine) as session:
        yield World(session)


def test_la_migrazione_crea_tutte_le_tabelle_e_combacia_con_i_modelli(engine: Engine) -> None:
    assert set(inspect(engine).get_table_names()) >= TABLES
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0003"
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []


def test_la_migrazione_scende_e_risale(url: str, engine: Engine) -> None:
    config = Config(str(SERVER_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(SERVER_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["from_app"] = True
    command.downgrade(config, "0001")
    assert not TABLES & set(inspect(make_engine(url)).get_table_names())
    command.upgrade(config, "head")
    assert set(inspect(make_engine(url)).get_table_names()) >= TABLES


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount_cents": 0},
        {"amount_cents": -5},
        {"date": "03/11/2026"},
        {"type": "refund"},
        {"type": "transfer", "split": None},
        {"to_account_id": "same"},
        {"visibility": "private"},
        {"visibility": "secret"},
    ],
    ids=[
        "zero",
        "negativo",
        "data",
        "tipo",
        "giroconto_senza_conto",
        "stesso_conto",
        "privato_senza_owner",
        "vis",
    ],
)
def test_i_check_rifiutano_movimenti_impossibili(world: World, overrides: dict[str, Any]) -> None:
    if overrides.get("to_account_id") == "same":
        overrides = {"type": "transfer", "split": None, "to_account_id": world.shared}
    with pytest.raises(IntegrityError):
        world.add(world.tx(**overrides))


def test_un_movimento_non_punta_a_un_conto_di_un_altra_famiglia(world: World) -> None:
    with pytest.raises(IntegrityError):
        world.add(world.tx(account_id=world.other_family_account))


def test_un_movimento_non_cita_un_membro_di_un_altra_famiglia(world: World) -> None:
    with pytest.raises(IntegrityError):
        world.add(world.tx(payer_member_id=world.m_carla))


def test_un_giroconto_valido_passa(world: World) -> None:
    world.add(world.tx(type="transfer", split=None, to_account_id=world.private))
    assert world.session.scalars(select(Transaction)).one().type == "transfer"


def test_conto_privato_senza_proprietario_e_ruolo_sconosciuto_rifiutati(world: World) -> None:
    with pytest.raises(IntegrityError):
        world.add(
            Account(
                id=uuid.uuid4(),
                family_id=world.f1,
                name="X",
                kind="cash",
                visibility="private",
                initial_balance_date="2026-01-01",
                **audit(world.m_anna),
            )
        )
    world.session.rollback()
    with pytest.raises(IntegrityError):
        world.member(world.f1, world.carla, "admin")


def test_un_utente_ha_un_solo_membro_per_famiglia(world: World) -> None:
    with pytest.raises(IntegrityError):
        world.member(world.f1, world.bruno, "member")


def test_impronta_unica_per_famiglia(world: World) -> None:
    """AC-6: la seconda riga con la stessa impronta fallisce (diventa 409 nella route)."""
    first, second = world.tx(), world.tx()
    other = world.tx(family_id=world.f2, account_id=world.other_family_account, **audit(world.m_carla))
    other.split = {"kind": "bp", "source": "default", "shares": {str(world.m_carla): 10000}}
    world.add(first, second, other)
    fp = "0123456789abcdef0123456789abcdef"
    world.add(
        TransactionFingerprint(family_id=world.f1, fingerprint=fp, transaction_id=first.id),
        TransactionFingerprint(family_id=world.f2, fingerprint=fp, transaction_id=other.id),
    )
    with pytest.raises(IntegrityError):
        world.add(TransactionFingerprint(family_id=world.f1, fingerprint=fp, transaction_id=second.id))


def test_nome_del_destinatario_unico_per_famiglia(world: World) -> None:
    def payee(family_id: uuid.UUID, by: uuid.UUID) -> Payee:
        return Payee(id=uuid.uuid4(), family_id=family_id, name="Bar", normalized_name="bar", **audit(by))

    world.add(payee(world.f1, world.m_anna), payee(world.f2, world.m_carla))
    with pytest.raises(IntegrityError):
        world.add(payee(world.f1, world.m_anna))


def test_conti_e_categorie_usati_non_si_cancellano(world: World) -> None:
    category = Category(
        id=uuid.uuid4(), family_id=world.f1, name="Spesa", kind="expense", **audit(world.m_anna)
    )
    world.add(category)
    world.add(world.tx(category_id=category.id))
    with pytest.raises(IntegrityError):
        world.session.execute(delete(Account).where(Account.id == world.shared))
        world.session.commit()
    world.session.rollback()
    with pytest.raises(IntegrityError):
        world.session.execute(delete(Category).where(Category.id == category.id))
        world.session.commit()


def test_cancellare_una_famiglia_cancella_tutto_il_suo_contenuto(world: World) -> None:
    world.add(world.tx())
    world.session.execute(delete(Family).where(Family.id == world.f1))
    world.session.commit()
    assert world.session.scalars(select(Transaction)).all() == []
    assert {a.family_id for a in world.session.scalars(select(Account))} == {world.f2}


def test_chi_non_e_membro_riceve_404(world: World) -> None:
    """AC-5: un utente di un'altra famiglia non vede nemmeno che F1 esiste."""
    assert active_member(world.session, world.f1, world.carla) is None
    with pytest.raises(HTTPException) as error:
        require_member(world.session, world.f1, world.carla)
    assert error.value.status_code == 404
    assert require_member(world.session, world.f1, world.anna).id == world.m_anna


def test_chi_e_uscito_perde_l_accesso(world: World) -> None:
    bruno = world.session.get(Member, world.m_bruno)
    assert bruno is not None
    bruno.left_at_ms = 5
    world.session.commit()
    assert active_member(world.session, world.f1, world.bruno) is None


def test_le_query_restano_nella_famiglia_e_filtrano_i_privati(world: World) -> None:
    private_tx = world.tx(account_id=world.private, visibility="private", owner_member_id=world.m_anna)
    shared_tx = world.tx()
    other = world.tx(family_id=world.f2, account_id=world.other_family_account, **audit(world.m_carla))
    other.split = {"kind": "bp", "source": "default", "shares": {str(world.m_carla): 10000}}
    world.add(private_tx, shared_tx, other)

    anna = require_member(world.session, world.f1, world.anna)
    bruno = require_member(world.session, world.f1, world.bruno)
    carla = require_member(world.session, world.f2, world.carla)

    def ids(model: type[Account] | type[Transaction], member: Member) -> set[uuid.UUID]:
        return {row.id for row in world.session.scalars(scoped(model, member))}

    assert ids(Transaction, anna) == {private_tx.id, shared_tx.id}
    assert ids(Transaction, bruno) == {shared_tx.id}
    assert ids(Transaction, carla) == {other.id}
    assert ids(Account, bruno) == {world.shared}
    assert ids(Account, anna) == {world.shared, world.private}
    assert {m.id for m in world.session.scalars(scoped(Member, bruno))} == {world.m_anna, world.m_bruno}
