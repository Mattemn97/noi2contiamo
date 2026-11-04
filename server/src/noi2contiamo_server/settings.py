import secrets
from functools import lru_cache
from typing import Literal

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
