"""Scrive lo schema OpenAPI dell'API in un file: `python -m noi2contiamo_server.openapi <percorso>`."""

import json
import sys
from pathlib import Path

from .main import create_app
from .settings import Settings


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    app = create_app(Settings(static_dir="__nessuna__"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
