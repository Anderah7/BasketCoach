"""Add protected media metadata for avatars, exercises and training sessions.

Revision ID: 2d8e7c9a4b10
Revises: b6f0e3a7c912
"""

from alembic import op
import sqlalchemy as sa


revision = "2d8e7c9a4b10"
down_revision = "b6f0e3a7c912"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_key", sa.String(length=80), nullable=False, unique=True),
        sa.Column("content_type", sa.String(length=60), nullable=False),
        sa.Column("media_type", sa.String(length=8), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("avatar_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True, unique=True),
        sa.Column("exercise_id", sa.Integer(), sa.ForeignKey("exercises.id"), nullable=True),
        sa.Column("training_id", sa.Integer(), sa.ForeignKey("trainings.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(CASE WHEN avatar_user_id IS NOT NULL THEN 1 ELSE 0 END) + "
            "(CASE WHEN exercise_id IS NOT NULL THEN 1 ELSE 0 END) + "
            "(CASE WHEN training_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_media_single_owner",
        ),
    )
    op.create_index("ix_media_assets_exercise_id", "media_assets", ["exercise_id"])
    op.create_index("ix_media_assets_training_id", "media_assets", ["training_id"])


def downgrade() -> None:
    op.drop_index("ix_media_assets_training_id", table_name="media_assets")
    op.drop_index("ix_media_assets_exercise_id", table_name="media_assets")
    op.drop_table("media_assets")
