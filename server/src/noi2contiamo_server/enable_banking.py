"""Client di Enable Banking (open banking, feature 24), condiviso da server e script da terminale.

Ogni richiesta porta un JWT RS256 firmato con la chiave privata dell'app (kid = id dell'app). Il browser
non può chiamare l'API (nessuna intestazione CORS): firma e inoltro stanno sempre in un backend.
"""

import time
from collections.abc import Callable
from typing import Any

import httpx
import jwt

BASE_URL = "https://api.enablebanking.com"
JWT_TTL_SECONDS = 3600
MAX_CONSENT_DAYS = 180
TIMEOUT_SECONDS = 30.0
MAX_PAGES = 50


class BankError(Exception):
    """Errore atteso verso la banca: `code` è not_configured, bank_error o consent_expired."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def make_jwt(app_id: str, private_key_pem: str, now: float | None = None) -> str:
    iat = int(time.time() if now is None else now)
    claims = {
        "iss": "enablebanking.com",
        "aud": "api.enablebanking.com",
        "iat": iat,
        "exp": iat + JWT_TTL_SECONDS,
    }
    try:
        return jwt.encode(claims, private_key_pem, algorithm="RS256", headers={"typ": "JWT", "kid": app_id})
    except (ValueError, TypeError, jwt.PyJWTError) as error:
        raise BankError("not_configured", "La chiave privata non è valida.") from error


def consent_days(max_validity: Any) -> int:
    """Giorni di consenso: il massimo della banca, mai oltre 180 (se non lo dice, 90).

    Enable Banking dà `maximum_consent_validity` in secondi; un valore piccolo si legge come giorni.
    """
    if isinstance(max_validity, int) and max_validity > 0:
        days = max_validity // 86400 if max_validity > 3650 else max_validity
        return max(1, min(days, MAX_CONSENT_DAYS))
    return 90


def _is_expired(response: httpx.Response) -> bool:
    return response.status_code in (401, 403, 410) and "expired" in response.text.lower()


class EnableBankingClient:
    def __init__(
        self,
        app_id: str,
        private_key_pem: str,
        *,
        transport: httpx.BaseTransport | None = None,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._app_id = app_id
        self._key = private_key_pem
        self._now = now
        self._http = httpx.Client(base_url=BASE_URL, timeout=TIMEOUT_SECONDS, transport=transport)

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"Authorization": f"Bearer {make_jwt(self._app_id, self._key, self._now())}"}
        try:
            response = self._http.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise BankError("bank_error", "Enable Banking non risponde.") from error
        if _is_expired(response):
            raise BankError("consent_expired", "Il consenso alla banca è scaduto: collega di nuovo la banca.")
        if response.status_code >= 400:
            detail = ""
            try:
                body = response.json()
                detail = str(body.get("message") or body.get("error") or "") if isinstance(body, dict) else ""
            except ValueError:
                pass
            raise BankError("bank_error", detail or f"Enable Banking ha risposto {response.status_code}.")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as error:
            raise BankError("bank_error", "Risposta non valida da Enable Banking.") from error

    def aspsps(self, country: str) -> list[dict[str, Any]]:
        data = self._request("GET", "/aspsps", params={"country": country, "psu_type": "personal"})
        banks = data.get("aspsps", []) if isinstance(data, dict) else []
        return [b for b in banks if isinstance(b, dict) and b.get("name")]

    def start_auth(
        self, *, aspsp_name: str, country: str, redirect_url: str, state: str, valid_until: str
    ) -> dict[str, Any]:
        body = {
            "access": {"valid_until": valid_until},
            "aspsp": {"name": aspsp_name, "country": country},
            "state": state,
            "redirect_url": redirect_url,
            "psu_type": "personal",
        }
        return self._request("POST", "/auth", json=body)

    def create_session(self, code: str) -> dict[str, Any]:
        return self._request("POST", "/sessions", json={"code": code})

    def delete_session(self, session_id: str) -> None:
        self._request("DELETE", f"/sessions/{session_id}")

    def transactions(self, account_uid: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
        """Tutte le pagine, seguendo `continuation_key`."""
        out: list[dict[str, Any]] = []
        params: dict[str, str] = {"date_from": date_from, "date_to": date_to}
        for _ in range(MAX_PAGES):
            data = self._request("GET", f"/accounts/{account_uid}/transactions", params=params)
            if not isinstance(data, dict):
                break
            out.extend(t for t in data.get("transactions", []) if isinstance(t, dict))
            key = data.get("continuation_key")
            if not key:
                break
            params = {"date_from": date_from, "date_to": date_to, "continuation_key": str(key)}
        return out


def summarize_session(data: dict[str, Any]) -> dict[str, Any]:
    """Dalla risposta di POST /sessions ai soli campi che servono: sessione, validità, conti."""
    accounts = []
    for a in data.get("accounts", []):
        if not isinstance(a, dict) or not a.get("uid"):
            continue
        account_id = a.get("account_id") or {}
        accounts.append(
            {
                "uid": a["uid"],
                "iban": account_id.get("iban") if isinstance(account_id, dict) else None,
                "name": a.get("name") or a.get("product") or "",
                "currency": a.get("currency") or "EUR",
            }
        )
    access = data.get("access") or {}
    return {
        "sessionId": data.get("session_id", ""),
        "validUntil": access.get("valid_until", "") if isinstance(access, dict) else "",
        "accounts": accounts,
    }
