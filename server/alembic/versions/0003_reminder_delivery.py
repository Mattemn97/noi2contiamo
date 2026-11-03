"""Consegna dei promemoria (feature 19): tentativi e canali già serviti.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("send_attempts", sa.Integer(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("sent_channels", sa.String(length=64), server_default="", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_column("sent_channels")
        batch_op.drop_column("send_attempts")
