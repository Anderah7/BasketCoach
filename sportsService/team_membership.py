"""Operaciones compartidas de pertenencia de jugadores a equipos."""

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    AssignmentStatus,
    Lineup,
    LineupPlayer,
    Match,
    MatchAvailability,
    MatchStatus,
    PlayerProfile,
    Training,
    TrainingAssignment,
)


def is_jersey_conflict(exc: IntegrityError) -> bool:
    return (
        getattr(exc.orig, "sqlstate", None) == "23505"
        and getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        == "uq_team_jersey_number"
    )


def detach_player(db: Session, profile: PlayerProfile, team_id: int) -> None:
    """Retira asociaciones operativas y conserva los registros históricos."""
    try:
        assignments = db.scalars(
            select(TrainingAssignment)
            .join(TrainingAssignment.training)
            .where(
                Training.team_id == team_id,
                TrainingAssignment.player_id == profile.user_id,
            )
            .order_by(TrainingAssignment.id)
            .with_for_update(of=TrainingAssignment)
        ).all()
        for assignment in assignments:
            if assignment.status in (AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS):
                assignment.status = AssignmentStatus.CANCELLED
                assignment.completed_at = None
            elif assignment.status == AssignmentStatus.CANCELLED:
                assignment.completed_at = None

        lineup_entries = db.scalars(
            select(LineupPlayer)
            .join(LineupPlayer.lineup)
            .where(Lineup.team_id == team_id, LineupPlayer.player_id == profile.user_id)
        ).all()
        for entry in lineup_entries:
            db.delete(entry)

        future_availabilities = db.scalars(
            select(MatchAvailability)
            .join(MatchAvailability.match)
            .where(
                MatchAvailability.player_id == profile.user_id,
                Match.status == MatchStatus.SCHEDULED,
                or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
            )
        ).all()
        for availability in future_availabilities:
            db.delete(availability)

        profile.team = None
        profile.jersey_number = None
        profile.strengths = None
        profile.weaknesses = None
        db.commit()
    except Exception:
        db.rollback()
        raise
