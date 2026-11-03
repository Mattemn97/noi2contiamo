"""Modelli Pydantic: la stessa forma JSON dei documenti di `packages/core` (spec 0002).

I nomi dei campi sono quelli delle colonne SQL (snake_case); in JSON viaggiano in camelCase.
Gli oggetti annidati (quote, provenienza, pareggio) restano in camelCase anche nelle colonne JSON,
così un documento letto dal database è identico a quello scritto dal client.
"""

import datetime as dt
import re
import unicodedata
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    model_validator,
)
from pydantic.alias_generators import to_camel

UUID7 = r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
FULL_BP = 10000


def _iso_date(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("data non YYYY-MM-DD")
    dt.date.fromisoformat(value)
    return value


Id = Annotated[str, StringConstraints(pattern=UUID7)]
IsoDate = Annotated[str, AfterValidator(_iso_date)]
Ms = Annotated[StrictInt, Field(ge=0)]
Bp = Annotated[StrictInt, Field(ge=0, le=FULL_BP)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
UserId = Annotated[str, StringConstraints(min_length=1, max_length=128)]


class Strict(BaseModel):
    """Campi sconosciuti rifiutati (AC-1)."""

    model_config = ConfigDict(extra="forbid")


class SplitSpec(Strict):
    kind: Literal["bp"]
    shares: dict[Id, Bp]

    @model_validator(mode="after")
    def _sum(self) -> "SplitSpec":
        if sum(self.shares.values()) != FULL_BP:
            raise ValueError("le quote devono sommare a 10000")
        return self


class TransactionSplit(Strict):
    kind: Literal["bp", "cents"]
    source: Literal["default", "category", "rule", "manual"]
    shares: dict[Id, Annotated[StrictInt, Field(ge=0)]]

    @model_validator(mode="after")
    def _sum(self) -> "TransactionSplit":
        if not self.shares:
            raise ValueError("servono quote per almeno un membro")
        if self.kind == "bp" and sum(self.shares.values()) != FULL_BP:
            raise ValueError("le quote devono sommare a 10000")
        return self


class Settlement(Strict):
    fromMemberId: Id
    toMemberId: Id


Provenance = Literal["manual", "rule", "import", "default"]


class TxProvenance(Strict):
    category: Provenance = "manual"
    payee: Provenance = "manual"
    split: Provenance = "manual"


class Doc(BaseModel):
    """Documento di famiglia. L'audit arriva dal client ma lo riscrive sempre il server."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=False, extra="forbid")

    id: Id
    created_at_ms: Ms | None = None
    created_by_member_id: Id | None = None
    updated_at_ms: Ms | None = None
    updated_by_member_id: Id | None = None


class MemberDoc(Doc):
    display_name: Name
    user_id: UserId | None = None
    role: Literal["owner", "member"]
    color: Annotated[str, StringConstraints(max_length=32)] | None = None
    joined_at_ms: Ms
    left_at_ms: Ms | None = None


class InviteDoc(Doc):
    role: Literal["owner", "member"] = "member"
    member_id: Id | None = None
    expires_at_ms: Ms
    used_at_ms: Ms | None = None
    used_by_user_id: UserId | None = None
    revoked_at_ms: Ms | None = None


class AccountDoc(Doc):
    name: Name
    kind: Literal["checking", "savings", "cash", "card", "other"]
    owner_member_id: Id | None = None
    visibility: Literal["shared", "private"] = "shared"
    initial_balance_cents: StrictInt = 0
    initial_balance_date: IsoDate
    order: StrictInt = 0
    archived_at_ms: Ms | None = None

    @model_validator(mode="after")
    def _private_owner(self) -> "AccountDoc":
        if self.visibility == "private" and self.owner_member_id is None:
            raise ValueError("un conto privato richiede ownerMemberId")
        return self


class CategoryDoc(Doc):
    name: Name
    kind: Literal["income", "expense"]
    parent_id: Id | None = None
    default_split: SplitSpec | None = None
    color: Annotated[str, StringConstraints(max_length=32)] | None = None
    icon: Annotated[str, StringConstraints(max_length=64)] | None = None
    order: StrictInt = 0
    archived_at_ms: Ms | None = None


def normalize(text: str) -> str:
    """Come `normalize` di `packages/core`: minuscolo, senza accenti, spazi compressi."""
    stripped = "".join(c for c in unicodedata.normalize("NFD", text) if not 0x300 <= ord(c) <= 0x36F)
    return re.sub(r"\s+", " ", stripped.lower()).strip()


class PayeeDoc(Doc):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    normalized_name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    archived_at_ms: Ms | None = None

    @model_validator(mode="after")
    def _normalized(self) -> "PayeeDoc":
        if self.normalized_name != normalize(self.name):
            raise ValueError("normalizedName deve essere normalize(name)")
        return self


class TransactionDoc(Doc):
    type: Literal["income", "expense", "transfer"]
    date: IsoDate
    amount_cents: Annotated[StrictInt, Field(gt=0)]
    is_refund: StrictBool = False
    account_id: Id
    to_account_id: Id | None = None
    category_id: Id | None = None
    payee_id: Id | None = None
    description: Annotated[str, StringConstraints(max_length=500)] = ""
    notes: Annotated[str, StringConstraints(max_length=1000)] | None = None
    payer_member_id: Id | None = None
    split: TransactionSplit | None = None
    settlement: Settlement | None = None
    visibility: Literal["shared", "private"] = "shared"
    owner_member_id: Id | None = None
    provenance: TxProvenance = Field(default_factory=TxProvenance)
    rule_ids: list[Id] = Field(default_factory=list)
    import_batch_id: Id | None = None
    import_fingerprints: Annotated[
        list[Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]], Field(max_length=2)
    ] = Field(default_factory=list)
    recurrence_id: Id | None = None
    recurrence_due_date: IsoDate | None = None

    @model_validator(mode="after")
    def _shape(self) -> "TransactionDoc":
        issues = transaction_shape_issues(self)
        if issues:
            raise ValueError("; ".join(issues))
        return self


TxType = Literal["income", "expense", "transfer"]
PositiveCents = Annotated[StrictInt, Field(gt=0)]


class RuleDescription(Strict):
    op: Literal["contains", "startsWith", "equals", "pattern"]
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class RuleConditions(Strict):
    """Come `ruleConditionsSchema` di core (spec 0007): i nomi restano in camelCase nel JSON."""

    match: Literal["all", "any"] = "all"
    types: Annotated[list[TxType], Field(min_length=1)] | None = None
    accountIds: Annotated[list[Id], Field(min_length=1)] | None = None
    payeeIds: Annotated[list[Id], Field(min_length=1)] | None = None
    memberIds: Annotated[list[Id], Field(min_length=1)] | None = None
    description: RuleDescription | None = None
    amountMinCents: PositiveCents | None = None
    amountMaxCents: PositiveCents | None = None

    @model_validator(mode="after")
    def _check(self) -> "RuleConditions":
        fields = self.model_dump(exclude_none=True, exclude={"match"})
        if not fields:
            raise ValueError("serve almeno una condizione")
        low, high = self.amountMinCents, self.amountMaxCents
        if low is not None and high is not None and low > high:
            raise ValueError("l'importo minimo supera il massimo")
        return self


class RuleActions(Strict):
    categoryId: Id | None = None
    payeeId: Id | None = None
    split: SplitSpec | None = None
    transferAccountId: Id | None = None
    recurring: Literal[True] | None = None

    @model_validator(mode="after")
    def _check(self) -> "RuleActions":
        if not self.model_dump(exclude_none=True):
            raise ValueError("serve almeno un'azione")
        if self.transferAccountId is not None and (self.categoryId is not None or self.split is not None):
            raise ValueError("un giroconto non ha categoria né divisione")
        return self


class RuleDoc(Doc):
    name: Name
    enabled: StrictBool = True
    order: StrictInt = 0
    conditions: RuleConditions
    actions: RuleActions


class RecurrenceFrequency(Strict):
    unit: Literal["day", "week", "month", "year"]
    interval: Annotated[StrictInt, Field(ge=1)]
    dayOfMonth: Annotated[StrictInt, Field(ge=1, le=31)] | None = None
    count: Annotated[StrictInt, Field(ge=1, le=1000)] | None = None


class RecurrenceDescription(Strict):
    op: Literal["contains", "startsWith", "equals"]
    value: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class RecurrenceDoc(Doc):
    """Come `recurrenceSchema` di core (spec 0008)."""

    name: Name
    type: TxType
    account_id: Id
    to_account_id: Id | None = None
    category_id: Id | None = None
    payee_id: Id | None = None
    expected_amount_cents: PositiveCents
    amount_tolerance_bp: Bp = 1000
    split: TransactionSplit | None = None
    frequency: RecurrenceFrequency
    start_date: IsoDate
    end_date: IsoDate | None = None
    match_window_days: Annotated[StrictInt, Field(ge=0)] = 5
    description_match: RecurrenceDescription | None = None
    skipped_dates: list[IsoDate] = Field(default_factory=list)
    archived_at_ms: Ms | None = None

    @model_validator(mode="after")
    def _shape(self) -> "RecurrenceDoc":
        issues: list[str] = []
        if self.type == "transfer":
            if self.to_account_id is None:
                issues.append("toAccountId: obbligatorio per un giroconto")
            if self.to_account_id == self.account_id:
                issues.append("toAccountId: deve essere diverso da accountId")
            if self.category_id is not None:
                issues.append("categoryId: vietato per un giroconto")
            if self.split is not None:
                issues.append("split: vietato per un giroconto")
        elif self.to_account_id is not None:
            issues.append("toAccountId: solo per un giroconto")
        if issues:
            raise ValueError("; ".join(issues))
        return self


class RecurrenceDismissalDoc(Doc):
    """L'id è la chiave del suggerimento scartato (un hash), non un UUID."""

    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")]  # type: ignore[assignment]
    dismissed_at_ms: Ms
    dismissed_by_member_id: Id


class ColHeader(Strict):
    header: Annotated[str, StringConstraints(min_length=1)]


class ColIndex(Strict):
    index: Annotated[StrictInt, Field(ge=0)]


ColRef = ColHeader | ColIndex


class ImportColumns(Strict):
    date: ColRef
    description: Annotated[list[ColRef], Field(min_length=1)]
    amount: ColRef | None = None
    debit: ColRef | None = None
    credit: ColRef | None = None
    payee: ColRef | None = None
    type: ColRef | None = None


class ImportSign(Strict):
    mode: Literal["negativeIsExpense", "positiveIsExpense", "debitCreditColumns", "typeColumn"]
    expenseValues: list[str] | None = None
    incomeValues: list[str] | None = None


class ImportProfileDoc(Doc):
    name: Name
    default_account_id: Id | None = None
    encoding: Literal["utf-8", "windows-1252", "iso-8859-1"] = "utf-8"
    delimiter: Literal[",", ";", "\t"]
    quote: Annotated[str, StringConstraints(min_length=1, max_length=1)] = '"'
    skip_rows: Annotated[StrictInt, Field(ge=0)] = 0
    has_header: StrictBool
    header_signature: Annotated[str, StringConstraints(max_length=128)] | None = None
    columns: ImportColumns
    date_format: Annotated[str, StringConstraints(min_length=1, max_length=32)]
    decimal_separator: Literal[",", "."]
    thousands_separator: Literal[".", ",", " ", ""]
    sign: ImportSign


class ImportBatchDoc(Doc):
    profile_id: Id | None = None
    account_id: Id
    file_name: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    file_hash: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    row_count: Annotated[StrictInt, Field(ge=0)]
    imported_count: Annotated[StrictInt, Field(ge=0)]
    duplicate_count: Annotated[StrictInt, Field(ge=0)]
    date_from: IsoDate
    date_to: IsoDate
    imported_at_ms: Ms


def transaction_shape_issues(tx: TransactionDoc) -> list[str]:
    """Le invarianti del movimento che non chiedono altri documenti (come `transactionShapeIssues`)."""
    issues: list[str] = []
    if tx.type == "transfer":
        if tx.to_account_id is None:
            issues.append("toAccountId: obbligatorio per un giroconto")
        if tx.to_account_id == tx.account_id:
            issues.append("toAccountId: deve essere diverso da accountId")
        if tx.category_id is not None:
            issues.append("categoryId: vietato per un giroconto")
        if tx.split is not None:
            issues.append("split: vietato per un giroconto")
        if tx.settlement and tx.settlement.fromMemberId == tx.settlement.toMemberId:
            issues.append("settlement: servono due membri diversi")
    else:
        if tx.to_account_id is not None:
            issues.append("toAccountId: solo per un giroconto")
        if tx.split is None:
            issues.append("split: obbligatorio per entrate e spese")
        if tx.settlement is not None:
            issues.append("settlement: solo per un giroconto")
    if tx.split and tx.split.kind == "cents" and sum(tx.split.shares.values()) != tx.amount_cents:
        issues.append("split: le quote in centesimi non sommano all'importo")
    if tx.visibility == "private":
        if tx.owner_member_id is None:
            issues.append("ownerMemberId: obbligatorio per un movimento privato")
        elif tx.split and any(m != tx.owner_member_id for m in tx.split.shares):
            issues.append("split: un movimento privato può dividere solo sul proprietario")
    return issues


class FamilyDoc(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    id: Id
    name: Name
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] = "EUR"
    default_split: SplitSpec
    schema_version: Annotated[StrictInt, Field(ge=1)] = 1
    created_by_user_id: UserId
    created_at_ms: Ms
    created_by_member_id: Id
    updated_at_ms: Ms
    updated_by_member_id: Id


# ---- Corpi delle richieste ---------------------------------------------------------------


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]


class Credentials(Camel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=8, max_length=1024)]


class Registration(Credentials):
    display_name: Name | None = None


class UserOut(Camel):
    id: str
    email: str


class SessionOut(Camel):
    user: UserOut | None
    csrf_token: str


class NewFamily(Camel):
    id: Id
    name: Name
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] = "EUR"
    default_split: SplitSpec | None = None
    schema_version: Annotated[StrictInt, Field(ge=1)] = 1


class OwnerMember(Camel):
    id: Id
    display_name: Name
    color: Annotated[str, StringConstraints(max_length=32)] | None = None


class FamilyDefaults(Camel):
    # Validate una per una dal server, così un errore indica la categoria sbagliata.
    categories: list[dict[str, Any]] = Field(default_factory=list)


class CreateFamily(Camel):
    family: NewFamily
    owner_member: OwnerMember
    defaults: FamilyDefaults = Field(default_factory=FamilyDefaults)


class CreatedFamily(Camel):
    family_id: str


class FamilySummary(Camel):
    family: FamilyDoc
    member_id: str
    role: Literal["owner", "member"]


class NewInvite(Camel):
    id: Id
    role: Literal["owner", "member"] = "member"
    member_id: Id | None = None
    expires_at_ms: Ms | None = None


class InviteToken(Camel):
    token: str


class AcceptInvite(Camel):
    token: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    display_name: Name


class Page(Camel):
    docs: list[dict[str, Any]]
    next: dict[str, Any] | None


class PutOp(Camel):
    type: Literal["put"]
    collection: str
    doc: dict[str, Any]


class RemoveOp(Camel):
    type: Literal["remove"]
    collection: str
    id: str


class Commit(Camel):
    ops: list[Annotated[PutOp | RemoveOp, Field(discriminator="type")]]
