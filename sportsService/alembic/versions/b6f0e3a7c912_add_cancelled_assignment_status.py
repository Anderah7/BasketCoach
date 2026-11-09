"""add_cancelled_assignment_status

Revision ID: b6f0e3a7c912
Revises: 3541688dbad6
"""

from alembic import op


revision = "b6f0e3a7c912"
down_revision = "3541688dbad6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy Enum(AssignmentStatus) stores enum member names in PostgreSQL.
    op.execute("ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'CANCELLED'")


def downgrade() -> None:
    # PostgreSQL cannot remove one enum label without rebuilding the type. A
    # rebuild would need a policy for existing CANCELLED rows, so fail safely.
    raise NotImplementedError(
        "No se puede retirar CANCELLED sin decidir cómo conservar las asignaciones canceladas"
    )
