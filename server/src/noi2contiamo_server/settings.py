import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configurazione letta dalle variabili N2C_* (e da un file .env, se c'è)."""

    model_config = SettingsConfigDict(env_prefix="N2C_", env_file=".env", extra="ignore")

    env: Literal["development", "production"] = "development"
    database_url: str = "sqlite:///./data/noi2contiamo.db"
    secret_key: str | None = None
    static_dir: str = "apps/web/dist"
    host: str = "127.0.0.1"
    port: int = 8000
    cookie_secure: Literal["auto", "true", "false"] = "auto"

    # Promemoria (feature 19). Ogni canale è facoltativo: senza le sue variabili resta spento, in silenzio.
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    reminder_interval_seconds: int = Field(default=60, ge=5, le=86_400)
    reminder_max_attempts: int = Field(default=5, ge=1, le=50)
    reminder_max_age_hours: int = Field(default=72, ge=1, le=24 * 30)

    @model_validator(mode="after")
    def _channels_complete(self) -> "Settings":
        if self.smtp_host and not self.smtp_from:
            raise ValueError("N2C_SMTP_HOST richiede anche N2C_SMTP_FROM.")
        if bool(self.telegram_bot_token) != bool(self.telegram_chat_id):
            raise ValueError("N2C_TELEGRAM_BOT_TOKEN e N2C_TELEGRAM_CHAT_ID vanno impostati insieme.")
        return self

    def resolved_secret_key(self) -> str:
        if self.secret_key:
            return self.secret_key
        if self.env == "production":
            raise RuntimeError("N2C_SECRET_KEY è obbligatorio fuori dallo sviluppo.")
        # In sviluppo basta un segreto temporaneo: le sessioni non sopravvivono al riavvio.
        return secrets.token_urlsafe(32)


@lru_cache
def get_settings() -> Settings:
    return Settings()
