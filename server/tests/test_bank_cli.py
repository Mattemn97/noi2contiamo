"""`npm run bank:csv`: il CSV scritto è quello che l'import CSV dell'app legge da solo."""

from pathlib import Path
from typing import Any

from noi2contiamo_server.bank_cli import build_csv, csv_row, file_name, filter_banks, parse_redirect

FIXTURE = Path(__file__).resolve().parents[2] / "packages/core/src/import/fixtures/bank-cli.csv"


def tx(amount: str, indicator: str, **extra: Any) -> dict[str, Any]:
    return {
        "transaction_amount": {"currency": "EUR", "amount": amount},
        "credit_debit_indicator": indicator,
        "status": "BOOK",
        "booking_date": "2026-11-03",
        **extra,
    }


SAMPLE = [
    tx(
        "42.5",
        "DBIT",
        remittance_information=["Spesa settimanale", "Carta 1234"],
        creditor={"name": "Supermercato Rossi"},
    ),
    tx(
        "1234.56",
        "CRDT",
        booking_date="2026-11-02",
        remittance_information=["Stipendio ottobre"],
        debtor={"name": "Azienda Srl"},
    ),
    tx(
        "29.90",
        "DBIT",
        booking_date="2026-11-01",
        remittance_information=["Canone fibra"],
        creditor={"name": "Telecom"},
    ),
    tx("5.00", "DBIT", status="PDNG"),
    tx("1.00", "DBIT", booking_date="data storta"),
]


def test_il_csv_combacia_con_la_fixture_letta_dal_test_di_core() -> None:
    written = ("﻿" + build_csv(SAMPLE)).encode("utf-8")
    assert written == FIXTURE.read_bytes()


def test_righe_importi_e_segni_senza_float() -> None:
    assert csv_row(tx("0.10", "DBIT", creditor={"name": "Bar"})) == ["03/11/2026", "Bar", "Bar", "-0,10"]
    assert csv_row(tx("-7.5", "CRDT"))[3] == "7,50"  # type: ignore[index]
    assert csv_row(tx("1000000000000.01", "CRDT"))[3] == "1000000000000,01"  # type: ignore[index]
    assert csv_row(tx("5", "DBIT", status="PDNG")) is None
    assert csv_row(tx("x", "DBIT")) is None


def test_indirizzo_di_ritorno_e_ricerca_banche() -> None:
    assert parse_redirect("https://localhost/?code=abc&state=xyz") == ("abc", "xyz", None)
    assert parse_redirect("https://localhost/?error=access_denied&state=xyz") == (
        None,
        "xyz",
        "access_denied",
    )
    banks = [{"name": "Intesa Sanpaolo"}, {"name": "UniCredit"}]
    assert filter_banks(banks, "intesa") == [banks[0]]
    assert file_name(
        "Intesa Sanpaolo", {"uid": "u", "iban": "IT60X0542811101000000123456"}, "2026-08-01", "2026-10-30"
    ) == ("intesa-sanpaolo-3456-2026-08-01_2026-10-30.csv")
