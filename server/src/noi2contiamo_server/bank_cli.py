"""Scarica i movimenti dalla banca in file CSV da importare nell'app (feature 24, modalità senza server).

`npm run bank:csv`: per chi usa Firebase sul piano gratuito (Spark), dove non si possono avere funzioni.
Chiede banca e periodo, ti manda sul sito della banca e scrive un CSV per conto in `bank-csv/`, nel
formato che l'import CSV dell'app riconosce da solo: UTF-8 con BOM, separatore `;`, intestazione
`Data;Descrizione;Beneficiario;Importo`, date gg/mm/aaaa, importi con la virgola e `-` per le uscite.
"""

import argparse
import contextlib
import csv
import datetime as dt
import io
import os
import re
import secrets
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .enable_banking import BankError, EnableBankingClient, consent_days, summarize_session

HEADER = ["Data", "Descrizione", "Beneficiario", "Importo"]
DEFAULT_REDIRECT = "https://localhost/"
DEFAULT_DAYS = 90


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _name(party: Any) -> str:
    return _clean(party.get("name")) if isinstance(party, dict) else ""


def csv_amount(tx: dict[str, Any]) -> str | None:
    """Importo con la virgola e il segno meno per le uscite, senza passare dai float."""
    try:
        value = Decimal(str(tx["transaction_amount"]["amount"])).copy_abs()
    except (KeyError, TypeError, InvalidOperation):
        return None
    text = f"{value.quantize(Decimal('0.01')):f}".replace(".", ",")
    return f"-{text}" if tx.get("credit_debit_indicator") == "DBIT" else text


def csv_row(tx: dict[str, Any]) -> list[str] | None:
    """Una riga del CSV, o None se il movimento non è contabilizzato o non si legge."""
    if tx.get("status") not in (None, "BOOK"):
        return None
    raw = tx.get("booking_date") or tx.get("value_date") or tx.get("transaction_date") or ""
    try:
        date = dt.date.fromisoformat(str(raw)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return None
    amount = csv_amount(tx)
    if amount is None:
        return None
    payee = (
        _name(tx.get("creditor")) if tx.get("credit_debit_indicator") == "DBIT" else _name(tx.get("debtor"))
    )
    remittance = [_clean(s) for s in tx.get("remittance_information") or []]
    parts = [s for i, s in enumerate(remittance) if s and s not in remittance[:i]]
    return [date, " · ".join(parts) or payee, payee, amount]


def build_csv(transactions: list[dict[str, Any]]) -> str:
    """Il testo del CSV (senza BOM: lo aggiunge la scrittura con `utf-8-sig`)."""
    out = io.StringIO(newline="")
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow(HEADER)
    for tx in transactions:
        row = csv_row(tx)
        if row:
            writer.writerow(row)
    return out.getvalue()


def parse_redirect(url: str) -> tuple[str | None, str | None, str | None]:
    """(code, state, error) dall'indirizzo su cui la banca ti riporta."""
    query = parse_qs(urlparse(url.strip()).query)
    return tuple((query.get(key) or [None])[0] for key in ("code", "state", "error"))  # type: ignore[return-value]


def filter_banks(banks: list[dict[str, Any]], needle: str) -> list[dict[str, Any]]:
    wanted = needle.strip().lower()
    return [b for b in banks if wanted in b["name"].lower()]


def file_name(bank: str, account: dict[str, Any], date_from: str, date_to: str) -> str:
    tail = (account.get("iban") or account["uid"])[-4:]
    slug = re.sub(r"[^A-Za-z0-9]+", "-", bank).strip("-").lower() or "banca"
    return f"{slug}-{tail}-{date_from}_{date_to}.csv"


def ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    return answer or (default or "")


def pick(items: list[str], title: str) -> int:
    for i, item in enumerate(items, 1):
        print(f"  {i:>3}. {item}")
    while True:
        choice = ask(title)
        if choice.isdigit() and 1 <= int(choice) <= len(items):
            return int(choice) - 1
        print("Scrivi uno dei numeri della lista.")


def choose_bank(client: EnableBankingClient, country: str) -> dict[str, Any]:
    banks = client.aspsps(country)
    if not banks:
        raise BankError("bank_error", f"Nessuna banca trovata per il paese {country}.")
    while True:
        found = filter_banks(banks, ask("Cerca la tua banca (una parte del nome)"))
        if not found:
            print("Nessuna banca con questo nome, riprova.")
        elif len(found) > 25:
            print(f"{len(found)} banche trovate: scrivi più lettere per restringere.")
        else:
            return found[pick([b["name"] for b in found], "Numero della banca")]


def run(args: argparse.Namespace) -> int:
    app_id = args.app_id or os.environ.get("N2C_ENABLE_BANKING_APP_ID")
    key_file = args.key_file or os.environ.get("N2C_ENABLE_BANKING_KEY_FILE")
    if not app_id or not key_file:
        print("Servono l'id dell'app e il file della chiave privata di Enable Banking:")
        print(
            "  --app-id ... --key-file private.key"
            "   (oppure N2C_ENABLE_BANKING_APP_ID e N2C_ENABLE_BANKING_KEY_FILE)"
        )
        print("Vedi docs/guida-open-banking.md.")
        return 2
    try:
        pem = Path(key_file).read_text(encoding="utf-8")
    except OSError:
        print(f"Non riesco a leggere il file della chiave: {key_file}")
        return 2
    client = EnableBankingClient(app_id, pem)
    try:
        country = (args.country or ask("Paese della banca (sigla di due lettere)", "IT")).upper()
        bank = choose_bank(client, country)
        state = secrets.token_urlsafe(24)
        valid_until = (
            dt.datetime.now(dt.UTC) + dt.timedelta(days=consent_days(bank.get("maximum_consent_validity")))
        ).isoformat()
        started = client.start_auth(
            aspsp_name=bank["name"],
            country=country,
            redirect_url=args.redirect_url,
            state=state,
            valid_until=valid_until,
        )
        print("\nApri questo indirizzo nel browser e autorizza l'accesso alla banca:\n")
        print(f"  {started['url']}\n")
        print(f"Alla fine il browser ti porta su {args.redirect_url} (la pagina può dare errore: è normale).")
        print("Copia l'indirizzo COMPLETO dalla barra del browser e incollalo qui sotto.\n")
        code, returned_state, error = parse_redirect(ask("Indirizzo copiato"))
        if error or not code:
            print(f"La banca non ha dato l'autorizzazione ({error or 'indirizzo senza codice'}).")
            return 1
        if returned_state != state:
            print("L'indirizzo non corrisponde a questa richiesta: riparti da capo.")
            return 1
        session = summarize_session(client.create_session(code))
        accounts = session["accounts"]
        if not accounts:
            print("La banca non ha collegato nessun conto.")
            return 1
        labels = [f"{a['name'] or 'Conto'}  {a['iban'] or a['uid']}  ({a['currency']})" for a in accounts]
        print("\nConti collegati:")
        chosen = accounts if len(accounts) == 1 else None
        if chosen is None:
            for i, label in enumerate(labels, 1):
                print(f"  {i:>3}. {label}")
            answer = ask("Numeri dei conti da scaricare, separati da virgola (vuoto = tutti)")
            picked = {int(n) - 1 for n in re.findall(r"\d+", answer)}
            chosen = [a for i, a in enumerate(accounts) if not picked or i in picked]
        today = dt.date.today()
        date_to = ask("Fino al (aaaa-mm-gg)", today.isoformat())
        date_from = ask("Dal (aaaa-mm-gg)", (today - dt.timedelta(days=DEFAULT_DAYS)).isoformat())
        dt.date.fromisoformat(date_from)
        dt.date.fromisoformat(date_to)
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        for account in chosen:
            rows = client.transactions(account["uid"], date_from, date_to)
            path = out_dir / file_name(bank["name"], account, date_from, date_to)
            path.write_text(build_csv(rows), encoding="utf-8-sig", newline="")
            print(f"Scritto {path} ({len(rows)} movimenti)")
        print("\nOra apri l'app, vai su Importa e carica il file CSV: le colonne si riconoscono da sole.")
        with contextlib.suppress(BankError):
            client.delete_session(session["sessionId"])
        return 0
    except BankError as error:
        print(f"Errore: {error.message}")
        return 1
    except ValueError:
        print("Data non valida: usa il formato aaaa-mm-gg.")
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nInterrotto.")
        return 130
    finally:
        client.close()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="bank:csv", description="Scarica i movimenti bancari in CSV.")
    parser.add_argument("--app-id", help="id dell'app Enable Banking")
    parser.add_argument("--key-file", help="file della chiave privata (private.key)")
    parser.add_argument("--country", help="paese della banca, es. IT")
    parser.add_argument("--redirect-url", default=DEFAULT_REDIRECT, help=f"default {DEFAULT_REDIRECT}")
    parser.add_argument("--out", default="bank-csv", help="cartella dei CSV (default bank-csv)")
    sys.exit(run(parser.parse_args(argv)))


if __name__ == "__main__":
    main()
