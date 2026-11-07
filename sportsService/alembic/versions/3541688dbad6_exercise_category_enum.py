"""exercise_category_enum

Revision ID: 3541688dbad6
Revises: 8666165c279f
Create Date: 2026-11-07 12:37:22.288801

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '3541688dbad6'
down_revision: Union[str, Sequence[str], None] = '8666165c279f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

exercise_category = postgresql.ENUM(
    'Shooting',
    'Defense',
    'Physical',
    'Ball handling',
    'Passing',
    'Rebounding',
    'Tactics',
    name='exercise_category',
    create_type=False,
)


def upgrade() -> None:
    """Convert exercise categories to a PostgreSQL enum."""
    exercise_category.create(op.get_bind(), checkfirst=False)
    op.alter_column('exercises', 'category',
               existing_type=sa.VARCHAR(length=60),
               type_=exercise_category,
               existing_nullable=True,
               postgresql_using="""(
                   CASE lower(regexp_replace(btrim(category), '[[:space:]_-]+', ' ', 'g'))
                       WHEN 'shooting' THEN 'Shooting'
                       WHEN 'defense' THEN 'Defense'
                       WHEN 'physical' THEN 'Physical'
                       WHEN 'ball handling' THEN 'Ball handling'
                       WHEN 'passing' THEN 'Passing'
                       WHEN 'rebounding' THEN 'Rebounding'
                       WHEN 'tactics' THEN 'Tactics'
                       ELSE category
                   END
               )::exercise_category""")


def downgrade() -> None:
    """Restore the text column without changing category values."""
    op.alter_column('exercises', 'category',
               existing_type=exercise_category,
               type_=sa.VARCHAR(length=60),
               existing_nullable=True,
               postgresql_using='category::text')
    exercise_category.drop(op.get_bind(), checkfirst=False)
