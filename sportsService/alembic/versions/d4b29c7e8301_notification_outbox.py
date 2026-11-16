"""Add durable outgoing friendship notification events.

Revision ID: d4b29c7e8301
Revises: c7a943e51b20
"""
from alembic import op
import sqlalchemy as sa

revision = "d4b29c7e8301"
down_revision = "c7a943e51b20"
branch_labels = None
depends_on = None


def upgrade():
    # No existing users, requests or friendships are changed or backfilled.
    op.create_table(
        "notification_outbox",
        sa.Column("event_id", sa.String(120), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notification_outbox_due", "notification_outbox", ["delivered_at", "next_attempt_at"])


def downgrade():
    op.drop_index("ix_notification_outbox_due", table_name="notification_outbox")
    op.drop_table("notification_outbox")
