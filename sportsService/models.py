
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum as PythonEnum

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text,
    UniqueConstraint, func
)

from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship
)

class Base(DeclarativeBase):
    pass

class UserRole(PythonEnum):
    COACH = "coach"
    PLAYER = "player"
    FAN = "fan"

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), nullable=False)

    # Relaciones
    coached_teams: Mapped[list[Team]] = relationship(back_populates="coach")
    player_profile: Mapped[PlayerProfile | None] = relationship(back_populates="user", uselist=False)
    created_trainings: Mapped[list[Training]] = relationship(back_populates="creator")
    created_exercises: Mapped[list[Exercise]] = relationship(back_populates="creator")
    created_lineups: Mapped[list[Lineup]] = relationship(back_populates="creator")

class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    coach_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    invitation_code: Mapped[str | None] = mapped_column(String(32), unique=True)
    is_managed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relaciones
    coach: Mapped[User | None] = relationship(back_populates="coached_teams")
    players: Mapped[list[PlayerProfile]] = relationship(back_populates="team")
    trainings: Mapped[list[Training]] = relationship(back_populates="team")
    season_teams: Mapped[list[SeasonTeam]] = relationship(back_populates="team")
    home_matches: Mapped[list[Match]] = relationship(
        back_populates="home_team", foreign_keys=lambda: [Match.home_team_id]
    )
    away_matches: Mapped[list[Match]] = relationship(
        back_populates="away_team", foreign_keys=lambda: [Match.away_team_id]
    )
    lineups: Mapped[list[Lineup]] = relationship(back_populates="team")

class PlayerPosition(PythonEnum):
    POINT_GUARD = "Point Guard"
    SHOOTING_GUARD = "Shooting Guard"
    SMALL_FORWARD = "Small Forward"
    POWER_FORWARD = "Power Forward"
    CENTER = "Center"

class PlayerProfile(Base):
    __tablename__ = "player_profiles"

    __table_args__ = (
        UniqueConstraint(
            "team_id", "jersey_number",
            name="uq_team_jersey_number"
        ),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[PlayerPosition | None] = mapped_column(Enum(PlayerPosition, name="player_position"))
    height_cm: Mapped[int | None] = mapped_column(Integer)
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    birth_date: Mapped[date | None] = mapped_column(Date)
    strengths: Mapped[str | None] = mapped_column(Text)
    weaknesses: Mapped[str | None] = mapped_column(Text)

    # Relaciones
    user: Mapped[User] = relationship(
        back_populates="player_profile"
    )
    team: Mapped[Team | None] = relationship(
        back_populates="players"
    )
    training_assignments: Mapped[list[TrainingAssignment]] = relationship(
        back_populates="player"
    )
    player_stats: Mapped[list[PlayerStats]] = relationship(back_populates="player")
    match_availabilities: Mapped[list[MatchAvailability]] = relationship(
        back_populates="player"
    )
    lineup_players: Mapped[list[LineupPlayer]] = relationship(
        back_populates="player"
    )

class TrainingCreationMode(PythonEnum):
    MANUAL = "MANUAL"
    AI = "AI"
    AI_ASSISTED = "AI_ASSISTED"


class Training(Base):
    __tablename__ = "trainings"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)

    creation_mode: Mapped[TrainingCreationMode] = mapped_column(
        Enum(TrainingCreationMode, name="training_creation_mode"),
        default=TrainingCreationMode.MANUAL,
        nullable=False
    )

    # Relaciones
    team: Mapped[Team] = relationship(
        back_populates="trainings"
    )

    creator: Mapped[User] = relationship(
        back_populates="created_trainings"
    )

    training_exercises: Mapped[list[TrainingExercise]] = relationship(
        back_populates="training"
    )

    assignments: Mapped[list[TrainingAssignment]] = relationship(
        back_populates="training"
    )

class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(
        String(150), nullable=False
    )

    description: Mapped[str] = mapped_column(
        Text, nullable=False
    )

    category: Mapped[str | None] = mapped_column(String(60))
    difficulty: Mapped[str | None] = mapped_column(String(30))
    equipment: Mapped[str | None] = mapped_column(Text)

    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    is_public: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )

    # Relaciones
    creator: Mapped[User | None] = relationship(
        back_populates="created_exercises"
    )

    training_exercises: Mapped[list[TrainingExercise]] = relationship(
        back_populates="exercise"
    )

class TrainingExercise(Base):
    __tablename__ = "training_exercises"

    __table_args__ = (
        UniqueConstraint(
            "training_id",
            "exercise_order",
            name="uq_training_exercise_order"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    training_id: Mapped[int] = mapped_column(
        ForeignKey("trainings.id"), nullable=False
    )

    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id"), nullable=False
    )

    exercise_order: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    duration: Mapped[int | None] = mapped_column(Integer)
    sets: Mapped[int | None] = mapped_column(Integer)
    repetitions: Mapped[int | None] = mapped_column(Integer)

    # Relaciones
    training: Mapped[Training] = relationship(
        back_populates="training_exercises"
    )

    exercise: Mapped[Exercise] = relationship(
        back_populates="training_exercises"
    )

    exercise_progress: Mapped[list[ExerciseProgress]] = relationship(
        back_populates="training_exercise"
    )

class AssignmentStatus(str, PythonEnum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"

class TrainingAssignment(Base):
    __tablename__ = "training_assignments"

    __table_args__ = (
        UniqueConstraint(
            "training_id",
            "player_id",
            name="uq_training_player"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    training_id: Mapped[int] = mapped_column(
        ForeignKey("trainings.id"), nullable=False
    )

    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profiles.user_id"), nullable=False
    )

    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(AssignmentStatus, name="assignment_status"),
        default=AssignmentStatus.PENDING,
        nullable=False
    )

    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    # Relaciones
    training: Mapped[Training] = relationship(
        back_populates="assignments"
    )

    player: Mapped[PlayerProfile] = relationship(
        back_populates="training_assignments"
    )

    exercise_progress: Mapped[list[ExerciseProgress]] = relationship(
        back_populates="assignment"
    )

class ExerciseProgress(Base):
    __tablename__ = "exercise_progress"

    __table_args__ = (
        UniqueConstraint(
            "assignment_id",
            "training_exercise_id",
            name="uq_assignment_exercise"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("training_assignments.id"),
        nullable=False
    )

    training_exercise_id: Mapped[int] = mapped_column(
        ForeignKey("training_exercises.id"),
        nullable=False
    )

    completed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    notes: Mapped[str | None] = mapped_column(Text)

    # Relaciones
    assignment: Mapped[TrainingAssignment] = relationship(
        back_populates="exercise_progress"
    )

    training_exercise: Mapped[TrainingExercise] = relationship(
        back_populates="exercise_progress"
    )

class Competition(Base):
    __tablename__ = "competitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text)

    # Relaciones
    seasons: Mapped[list[Season]] = relationship(back_populates="competition")

class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Relaciones
    competition: Mapped[Competition] = relationship(back_populates="seasons")
    season_teams: Mapped[list[SeasonTeam]] = relationship(back_populates="season")
    matches: Mapped[list[Match]] = relationship(back_populates="season")

class SeasonTeam(Base):
    __tablename__ = "season_teams"

    __table_args__ = (
        UniqueConstraint("season_id", "team_id", name="uq_season_team"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)

    # Relaciones
    season: Mapped[Season] = relationship(back_populates="season_teams")
    team: Mapped[Team] = relationship(back_populates="season_teams")
    standing: Mapped[Standing | None] = relationship(
        back_populates="season_team", uselist=False
    )

class Standing(Base):
    __tablename__ = "standings"

    id: Mapped[int] = mapped_column(primary_key=True)
    season_team_id: Mapped[int] = mapped_column(
        ForeignKey("season_teams.id"), unique=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    played: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    wins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    losses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    points_for: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    points_against: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ranking_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    season_team: Mapped[SeasonTeam] = relationship(back_populates="standing")

class MatchStatus(str, PythonEnum):
    SCHEDULED = "SCHEDULED"
    FINISHED = "FINISHED"
    CANCELLED = "CANCELLED"

class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("seasons.id"))
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    match_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    location: Mapped[str | None] = mapped_column(String(150))
    home_score: Mapped[int | None] = mapped_column(Integer)
    away_score: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[MatchStatus] = mapped_column(
        Enum(MatchStatus, name="match_status"),
        default=MatchStatus.SCHEDULED,
        nullable=False
    )

    # Relaciones
    season: Mapped[Season | None] = relationship(back_populates="matches")
    home_team: Mapped[Team] = relationship(
        back_populates="home_matches", foreign_keys=[home_team_id]
    )
    away_team: Mapped[Team] = relationship(
        back_populates="away_matches", foreign_keys=[away_team_id]
    )
    player_stats: Mapped[list[PlayerStats]] = relationship(back_populates="match")
    availabilities: Mapped[list[MatchAvailability]] = relationship(
        back_populates="match"
    )

class PlayerStats(Base):
    __tablename__ = "player_stats"

    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="uq_match_player_stats"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profiles.user_id"), nullable=False
    )
    minutes: Mapped[int | None] = mapped_column(Integer)
    points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rebounds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assists: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    steals: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    blocks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    turnovers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    three_pt_made: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    three_pt_attempted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    free_throws_made: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    free_throws_attempted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    match: Mapped[Match] = relationship(back_populates="player_stats")
    player: Mapped[PlayerProfile] = relationship(back_populates="player_stats")

class MatchAvailabilityStatus(str, PythonEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    UNKNOWN = "UNKNOWN"

class MatchAvailability(Base):
    __tablename__ = "match_availabilities"

    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="uq_match_player_availability"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profiles.user_id"), nullable=False
    )
    status: Mapped[MatchAvailabilityStatus] = mapped_column(
        Enum(MatchAvailabilityStatus, name="match_availability_status"),
        default=MatchAvailabilityStatus.UNKNOWN,
        nullable=False
    )

    # Relaciones
    match: Mapped[Match] = relationship(back_populates="availabilities")
    player: Mapped[PlayerProfile] = relationship(
        back_populates="match_availabilities"
    )

class Lineup(Base):
    __tablename__ = "lineups"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Relaciones
    team: Mapped[Team] = relationship(back_populates="lineups")
    creator: Mapped[User] = relationship(back_populates="created_lineups")
    lineup_players: Mapped[list[LineupPlayer]] = relationship(
        back_populates="lineup"
    )

class LineupPlayer(Base):
    __tablename__ = "lineup_players"

    lineup_id: Mapped[int] = mapped_column(
        ForeignKey("lineups.id"), primary_key=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey("player_profiles.user_id"), primary_key=True
    )
    court_position: Mapped[str | None] = mapped_column(String(30))

    # Relaciones
    lineup: Mapped[Lineup] = relationship(back_populates="lineup_players")
    player: Mapped[PlayerProfile] = relationship(back_populates="lineup_players")





    
