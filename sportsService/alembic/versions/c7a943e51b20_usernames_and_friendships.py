"""Add optional usernames, friend requests and friendships.

Revision ID: c7a943e51b20
Revises: 2d8e7c9a4b10
"""

from alembic import op
import sqlalchemy as sa


revision = "c7a943e51b20"
down_revision = "2d8e7c9a4b10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing users keep NULL; no aliases or friendships are generated.
    op.add_column("users", sa.Column("username", sa.String(24), nullable=True))
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    op.create_check_constraint(
        "ck_users_username_normalized", "users",
        "username IS NULL OR (length(username) BETWEEN 3 AND 24 AND username = lower(username))",
    )
    op.create_check_constraint(
        "ck_users_username_characters", "users", "username IS NULL OR username ~ '^[a-z0-9_]{3,24}$'",
    )
    op.create_table(
        "friend_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recipient_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("user_low_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("user_high_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.Enum("PENDING", "ACCEPTED", "REJECTED", name="friend_request_status"), server_default="PENDING", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_friend_requests_ordered_pair"),
        sa.CheckConstraint(
            "(sender_id = user_low_id AND recipient_id = user_high_id) OR "
            "(sender_id = user_high_id AND recipient_id = user_low_id)",
            name="ck_friend_requests_participants",
        ),
        sa.CheckConstraint(
            "(status = 'PENDING' AND responded_at IS NULL) OR "
            "(status IN ('ACCEPTED', 'REJECTED') AND responded_at IS NOT NULL)",
            name="ck_friend_requests_response_time",
        ),
    )
    op.create_index("ix_friend_requests_sender_id", "friend_requests", ["sender_id"])
    op.create_index("ix_friend_requests_recipient_id", "friend_requests", ["recipient_id"])
    op.create_index(
        "uq_friend_requests_pending_pair", "friend_requests", ["user_low_id", "user_high_id"],
        unique=True, postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_table(
        "friendships",
        sa.Column("user_low_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("user_high_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_friendships_ordered_pair"),
    )
    op.create_index("ix_friendships_user_high_id", "friendships", ["user_high_id"])


def downgrade() -> None:
    op.drop_index("ix_friendships_user_high_id", table_name="friendships")
    op.drop_table("friendships")
    op.drop_index("uq_friend_requests_pending_pair", table_name="friend_requests")
    op.drop_index("ix_friend_requests_recipient_id", table_name="friend_requests")
    op.drop_index("ix_friend_requests_sender_id", table_name="friend_requests")
    op.drop_table("friend_requests")
    sa.Enum(name="friend_request_status").drop(op.get_bind(), checkfirst=True)
    op.drop_constraint("ck_users_username_characters", "users", type_="check")
    op.drop_constraint("ck_users_username_normalized", "users", type_="check")
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
