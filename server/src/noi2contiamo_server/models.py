"""Tabelle SQLAlchemy del data model (spec 0002).

Una tabella per collezione. Ogni tabella di famiglia ha `family_id` e un vincolo unico
`(family_id, id)`: i riferimenti tra documenti sono chiavi esterne composte, così un movimento
non può puntare a un conto di un'altra famiglia nemmeno per errore. Gli oggetti annidati stanno
in colonne JSON (li valida Pydantic quando arrivano le route, feature 5).
"""

import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def iso_date_check(column: str) -> str:
    """CHECK portabile (SQLite e PostgreSQL) sul formato `YYYY-MM-DD`."""
    return (
        f"length({column}) = 10 AND substr({column}, 5, 1) = '-' AND substr({column}, 8, 1) = '-' "
        f"AND substr({column}, 1, 4) BETWEEN '0000' AND '9999'"
    )


def in_check(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def ref(columns: tuple[str, str], table: str, ondelete: str | None = None) -> ForeignKeyConstraint:
    """Chiave esterna composta `(family_id, <col>)` verso `<table>(family_id, id)`."""
    return ForeignKeyConstraint(list(columns), [f"{table}.family_id", f"{table}.id"], ondelete=ondelete)


ROLES = ("owner", "member")
VISIBILITIES = ("shared", "private")
TX_TYPES = ("income", "expense", "transfer")


class Audit:
    created_at_ms: Mapped[int] = mapped_column(BigInteger)
    created_by_member_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger)
    updated_by_member_id: Mapped[uuid.UUID] = mapped_column(Uuid)


class FamilyScoped(Audit):
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)

    @declared_attr
    @classmethod
    def family_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(Uuid, ForeignKey("families.id", ondelete="CASCADE"), index=True)


# ---- Globali -----------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lower"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(60))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at_ms: Mapped[int] = mapped_column(BigInteger)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger)
    last_seen_at_ms: Mapped[int] = mapped_column(BigInteger)


class Family(Audit, Base):
    __tablename__ = "families"
    __table_args__ = (CheckConstraint("schema_version >= 1", name="schema_version"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    default_split: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    # Stringa opaca: in un export arriva l'uid dell'altro backend.
    created_by_user_id: Mapped[str] = mapped_column(String(128))


# ---- Di famiglia -------------------------------------------------------------------------


class Member(FamilyScoped, Base):
    __tablename__ = "members"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        UniqueConstraint("family_id", "user_id"),
        CheckConstraint(in_check("role", ROLES), name="role"),
    )

    display_name: Mapped[str] = mapped_column(String(60))
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    color: Mapped[str | None] = mapped_column(String(32))
    joined_at_ms: Mapped[int] = mapped_column(BigInteger)
    left_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Invite(FamilyScoped, Base):
    __tablename__ = "invites"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "member_id"), "members"),
        CheckConstraint(in_check("role", ROLES), name="role"),
    )

    role: Mapped[str] = mapped_column(String(16), default="member")
    member_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger)
    used_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    used_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Account(FamilyScoped, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "owner_member_id"), "members"),
        CheckConstraint(in_check("kind", ("checking", "savings", "cash", "card", "other")), name="kind"),
        CheckConstraint(in_check("visibility", VISIBILITIES), name="visibility"),
        CheckConstraint("visibility = 'shared' OR owner_member_id IS NOT NULL", name="private_owner"),
        CheckConstraint(iso_date_check("initial_balance_date"), name="initial_balance_date"),
    )

    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(16))
    owner_member_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    visibility: Mapped[str] = mapped_column(String(8), default="shared")
    initial_balance_cents: Mapped[int] = mapped_column(BigInteger, default=0)
    initial_balance_date: Mapped[str] = mapped_column(Text)
    order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Category(FamilyScoped, Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "parent_id"), "categories"),
        CheckConstraint(in_check("kind", ("income", "expense")), name="kind"),
    )

    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(8))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    default_split: Mapped[dict | None] = mapped_column(JSON)
    color: Mapped[str | None] = mapped_column(String(32))
    icon: Mapped[str | None] = mapped_column(String(64))
    order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Payee(FamilyScoped, Base):
    __tablename__ = "payees"
    __table_args__ = (UniqueConstraint("family_id", "id"), UniqueConstraint("family_id", "normalized_name"))

    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String(100))
    archived_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Rule(FamilyScoped, Base):
    __tablename__ = "rules"
    __table_args__ = (UniqueConstraint("family_id", "id"),)

    name: Mapped[str] = mapped_column(String(60))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
    conditions: Mapped[dict] = mapped_column(JSON)
    actions: Mapped[dict] = mapped_column(JSON)


class ImportProfile(FamilyScoped, Base):
    __tablename__ = "import_profiles"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "default_account_id"), "accounts"),
        Index(None, "family_id", "header_signature"),
    )

    name: Mapped[str] = mapped_column(String(60))
    default_account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    encoding: Mapped[str] = mapped_column(String(16), default="utf-8")
    delimiter: Mapped[str] = mapped_column(String(1))
    quote: Mapped[str] = mapped_column(String(1), default='"')
    skip_rows: Mapped[int] = mapped_column(Integer, default=0)
    has_header: Mapped[bool] = mapped_column(Boolean)
    header_signature: Mapped[str | None] = mapped_column(String(128))
    columns: Mapped[dict] = mapped_column(JSON)
    date_format: Mapped[str] = mapped_column(String(32))
    decimal_separator: Mapped[str] = mapped_column(String(1))
    thousands_separator: Mapped[str] = mapped_column(String(1))
    sign: Mapped[dict] = mapped_column(JSON)


class ImportBatch(FamilyScoped, Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "profile_id"), "import_profiles"),
        ref(("family_id", "account_id"), "accounts"),
        CheckConstraint(iso_date_check("date_from"), name="date_from"),
        CheckConstraint(iso_date_check("date_to"), name="date_to"),
    )

    profile_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    account_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    file_name: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer)
    imported_count: Mapped[int] = mapped_column(Integer)
    duplicate_count: Mapped[int] = mapped_column(Integer)
    date_from: Mapped[str] = mapped_column(Text)
    date_to: Mapped[str] = mapped_column(Text)
    imported_at_ms: Mapped[int] = mapped_column(BigInteger)


class Recurrence(FamilyScoped, Base):
    __tablename__ = "recurrences"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "account_id"), "accounts"),
        ref(("family_id", "to_account_id"), "accounts"),
        ref(("family_id", "category_id"), "categories"),
        ref(("family_id", "payee_id"), "payees"),
        CheckConstraint(in_check("type", TX_TYPES), name="type"),
        CheckConstraint("expected_amount_cents > 0", name="expected_amount_positive"),
        CheckConstraint(iso_date_check("start_date"), name="start_date"),
    )

    name: Mapped[str] = mapped_column(String(60))
    type: Mapped[str] = mapped_column(String(8))
    account_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    payee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    expected_amount_cents: Mapped[int] = mapped_column(BigInteger)
    amount_tolerance_bp: Mapped[int] = mapped_column(Integer, default=1000)
    split: Mapped[dict | None] = mapped_column(JSON)
    frequency: Mapped[dict] = mapped_column(JSON)
    start_date: Mapped[str] = mapped_column(Text)
    end_date: Mapped[str | None] = mapped_column(Text)
    match_window_days: Mapped[int] = mapped_column(Integer, default=5)
    description_match: Mapped[dict | None] = mapped_column(JSON)
    skipped_dates: Mapped[list] = mapped_column(JSON, default=list)
    archived_at_ms: Mapped[int | None] = mapped_column(BigInteger)


class Transaction(FamilyScoped, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        ref(("family_id", "account_id"), "accounts", ondelete="RESTRICT"),
        ref(("family_id", "to_account_id"), "accounts", ondelete="RESTRICT"),
        ref(("family_id", "category_id"), "categories", ondelete="RESTRICT"),
        ref(("family_id", "payee_id"), "payees", ondelete="RESTRICT"),
        ref(("family_id", "payer_member_id"), "members"),
        ref(("family_id", "owner_member_id"), "members"),
        ref(("family_id", "import_batch_id"), "import_batches"),
        ref(("family_id", "recurrence_id"), "recurrences"),
        CheckConstraint(in_check("type", TX_TYPES), name="type"),
        CheckConstraint(in_check("visibility", VISIBILITIES), name="visibility"),
        CheckConstraint("amount_cents > 0", name="amount_positive"),
        CheckConstraint(iso_date_check("date"), name="date"),
        CheckConstraint("(type = 'transfer') = (to_account_id IS NOT NULL)", name="transfer_to_account"),
        CheckConstraint("to_account_id IS NULL OR to_account_id <> account_id", name="transfer_distinct"),
        CheckConstraint("type <> 'transfer' OR category_id IS NULL", name="transfer_no_category"),
        CheckConstraint("visibility = 'shared' OR owner_member_id IS NOT NULL", name="private_owner"),
        Index(None, "family_id", "visibility", "date"),
        Index(None, "family_id", "account_id", "date"),
        Index(None, "family_id", "owner_member_id", "date"),
        Index(None, "family_id", "recurrence_id"),
        Index(None, "family_id", "import_batch_id"),
    )

    type: Mapped[str] = mapped_column(String(8))
    date: Mapped[str] = mapped_column(Text)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    is_refund: Mapped[bool] = mapped_column(Boolean, default=False)
    account_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    payee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str | None] = mapped_column(Text)
    payer_member_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    split: Mapped[dict | None] = mapped_column(JSON)
    settlement: Mapped[dict | None] = mapped_column(JSON)
    visibility: Mapped[str] = mapped_column(String(8), default="shared")
    owner_member_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    provenance: Mapped[dict] = mapped_column(JSON)
    rule_ids: Mapped[list] = mapped_column(JSON, default=list)
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    recurrence_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    recurrence_due_date: Mapped[str | None] = mapped_column(Text)


class TransactionFingerprint(Base):
    """Rende impossibile importare due volte la stessa riga nella stessa famiglia (AC-6)."""

    __tablename__ = "transaction_fingerprints"
    __table_args__ = (
        PrimaryKeyConstraint("family_id", "fingerprint"),
        ref(("family_id", "transaction_id"), "transactions", ondelete="CASCADE"),
        CheckConstraint("length(fingerprint) = 32", name="fingerprint_length"),
    )

    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("families.id", ondelete="CASCADE"))
    fingerprint: Mapped[str] = mapped_column(String(32))
    transaction_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)


class RecurrenceDismissal(Audit, Base):
    """L'id è la chiave del suggerimento scartato (un hash), non un UUID."""

    __tablename__ = "recurrence_dismissals"
    __table_args__ = (PrimaryKeyConstraint("family_id", "id"),)

    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("families.id", ondelete="CASCADE"))
    id: Mapped[str] = mapped_column(String(128))
    dismissed_at_ms: Mapped[int] = mapped_column(BigInteger)
    dismissed_by_member_id: Mapped[uuid.UUID] = mapped_column(Uuid)


class MemberSettings(FamilyScoped, Base):
    """L'id è il `member_id` del proprietario."""

    __tablename__ = "member_settings"
    __table_args__ = (
        ref(("family_id", "id"), "members", ondelete="CASCADE"),
        CheckConstraint(in_check("default_view", ("family", "personal")), name="default_view"),
    )

    notifications: Mapped[dict] = mapped_column(JSON)
    channels: Mapped[dict] = mapped_column(JSON)
    default_view: Mapped[str] = mapped_column(String(16), default="family")


class Reminder(FamilyScoped, Base):
    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint("family_id", "id"),
        UniqueConstraint("family_id", "dedup_key"),
        ref(("family_id", "member_id"), "members"),
        CheckConstraint(in_check("kind", ("recurringDue", "settlement", "importReminder")), name="kind"),
        CheckConstraint(in_check("status", ("pending", "sent", "dismissed")), name="status"),
        Index(None, "family_id", "member_id"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(16))
    ref_id: Mapped[str | None] = mapped_column(String(128))
    fire_at_ms: Mapped[int] = mapped_column(BigInteger)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    sent_at_ms: Mapped[int | None] = mapped_column(BigInteger)
    dedup_key: Mapped[str] = mapped_column(String(200))
    # Solo del server (feature 19): tentativi di invio fatti e canali già serviti ("email,telegram").
    send_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sent_channels: Mapped[str] = mapped_column(String(64), default="", server_default="")


# ---- Open banking (feature 24) -----------------------------------------------------------


class BankAuthState(Base):
    """Richiesta di collegamento in corso: lo `state` casuale torna dalla banca insieme al codice."""

    __tablename__ = "bank_auth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    family_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    aspsp_name: Mapped[str] = mapped_column(String(200))
    country: Mapped[str] = mapped_column(String(2))
    created_at_ms: Mapped[int] = mapped_column(BigInteger)


class BankConnection(Base):
    """Banca collegata: la vede solo chi l'ha collegata (i conti bancari sono personali)."""

    __tablename__ = "bank_connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    family_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("families.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[str] = mapped_column(String(128))
    bank_name: Mapped[str] = mapped_column(String(200))
    country: Mapped[str] = mapped_column(String(2))
    valid_until: Mapped[str] = mapped_column(String(40))
    accounts: Mapped[list] = mapped_column(JSON)
    created_at_ms: Mapped[int] = mapped_column(BigInteger)
