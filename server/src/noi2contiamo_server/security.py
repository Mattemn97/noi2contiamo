"""Password, sessioni e protezione CSRF (spec 0001: Argon2id, sessione opaca, cookie HttpOnly).

- Password: Argon2id con `pwdlib`.
- Sessione: token casuale nel cookie `n2c_session` (HttpOnly, SameSite=Lax, Secure fuori da localhost);
  nel database solo lo SHA-256 del token, così una copia del database non apre sessioni.
- CSRF: double submit. Il cookie `n2c_csrf` (leggibile dal client) va ripetuto nell'intestazione
  `X-CSRF-Token` su ogni richiesta che scrive sotto `/api/v1`. Un sito estraneo non legge il cookie,
  quindi non può copiarlo nell'intestazione; SameSite=Lax è una seconda barriera.
"""

import hashlib
import secrets
import time
import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from .errors import ApiError
from .models import Session as SessionRow
from .models import User
from .settings import Settings

SESSION_COOKIE = "n2c_session"
CSRF_COOKIE = "n2c_csrf"
CSRF_HEADER = "x-csrf-token"
SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
LAST_SEEN_EVERY_MS = 5 * 60 * 1000
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

password_hash = PasswordHash.recommended()
# Hash di riferimento: chi prova un'email inesistente aspetta quanto chi sbaglia password.
_DUMMY_HASH = password_hash.hash("noi2contiamo-dummy-password")


def now_ms() -> int:
    return int(time.time() * 1000)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, stored: str | None) -> bool:
    if stored is None:
        password_hash.verify(password, _DUMMY_HASH)
        return False
    return password_hash.verify(password, stored)


def cookie_secure(settings: Settings, request: Request) -> bool:
    if settings.cookie_secure == "auto":
        return request.url.hostname not in LOCAL_HOSTS
    return settings.cookie_secure == "true"


def get_db(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session


def start_session(db: Session, user: User, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    t = now_ms()
    db.add(
        SessionRow(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=sha256(token),
            created_at_ms=t,
            expires_at_ms=t + SESSION_TTL_MS,
            last_seen_at_ms=t,
        )
    )
    settings: Settings = request.app.state.settings
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_MS // 1000,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(settings, request),
        path="/",
    )


def end_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        row = db.scalars(select(SessionRow).where(SessionRow.token_hash == sha256(token))).one_or_none()
        if row is not None:
            db.delete(row)
    response.delete_cookie(SESSION_COOKIE, path="/")


def optional_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = db.scalars(select(SessionRow).where(SessionRow.token_hash == sha256(token))).one_or_none()
    t = now_ms()
    if row is None or row.expires_at_ms <= t:
        return None
    if t - row.last_seen_at_ms > LAST_SEEN_EVERY_MS:
        row.last_seen_at_ms = t
        db.commit()
    return db.get(User, row.user_id)


def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise ApiError("unauthenticated")
    return user


def ensure_csrf_cookie(request: Request, response: Response) -> str:
    token = request.cookies.get(CSRF_COOKIE)
    if token:
        return token
    token = secrets.token_urlsafe(32)
    settings: Settings = request.app.state.settings
    response.set_cookie(
        CSRF_COOKIE, token, httponly=False, samesite="lax", secure=cookie_secure(settings, request), path="/"
    )
    return token


class CsrfMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in SAFE_METHODS and request.url.path.startswith(("/api/v1/", "/api/bank/")):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not secrets.compare_digest(cookie.encode(), header.encode()):
                return JSONResponse(status_code=403, content={"code": "forbidden", "message": "csrf"})
        return await call_next(request)
