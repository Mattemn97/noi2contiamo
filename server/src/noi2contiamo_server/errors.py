"""Errori attesi dell'API come risposte JSON con la stessa forma di `DataError` in `packages/data`.

Corpo: `{"code": ..., "reason"?: ..., "issues"?: [...], "message"?: ...}`.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

STATUS = {
    "unauthenticated": 401,
    "forbidden": 403,
    "not_found": 404,
    "conflict": 409,
    "expired": 410,
    "used": 410,
    "revoked": 410,
    "invalid": 422,
    "invalid_query": 422,
}


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        *,
        reason: str | None = None,
        issues: list[dict[str, str]] | None = None,
        message: str | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.body: dict[str, Any] = {"code": code}
        if reason is not None:
            self.body["reason"] = reason
        if issues is not None:
            self.body["issues"] = issues
        if message is not None:
            self.body["message"] = message


def invalid(message: str, path: str = "") -> ApiError:
    return ApiError("invalid", issues=[{"path": path, "message": message}])


def conflict(reason: str) -> ApiError:
    return ApiError("conflict", reason=reason)


def issues_of(error: ValidationError | RequestValidationError) -> list[dict[str, str]]:
    return [
        {"path": ".".join(str(p) for p in issue["loc"] if p != "body"), "message": issue["msg"]}
        for issue in error.errors()
    ]


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(status_code=STATUS[error.code], content=error.body)

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"code": "invalid", "issues": issues_of(error)})
