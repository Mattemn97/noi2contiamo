import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from noi2contiamo_server.models import Base

config = context.config

# Da riga di comando vale N2C_DATABASE_URL; dal server l'URL è già impostato in config.
if os.environ.get("N2C_DATABASE_URL") and not config.attributes.get("from_app"):
    config.set_main_option("sqlalchemy.url", os.environ["N2C_DATABASE_URL"])

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
