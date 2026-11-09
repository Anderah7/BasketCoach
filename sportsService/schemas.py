from datetime import datetime, date
from decimal import Decimal

from pydantic import AwareDatetime, BaseModel, EmailStr, Field, ConfigDict, PositiveInt, StrictBool, field_validator
from models import UserRole, PlayerPosition, ExerciseCategory, TrainingCreationMode, AssignmentStatus

class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6)
    role: UserRole

class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: datetime

class PlayerProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: PlayerPosition | None = None
    height_cm: int | None = Field(default=None, gt=0)
    weight_kg: Decimal | None = Field(default=None, gt=0, max_digits=5, decimal_places=2)
    birth_date: date | None = None

class PlayerProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    team_id: int | None
    jersey_number: int | None
    position: PlayerPosition | None
    height_cm: int | None
    weight_kg: Decimal | None
    birth_date: date | None
    strengths: str | None
    weaknesses: str | None

class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=60)

class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str | None
    coach_id: int | None
    invitation_code: str | None
    is_managed: bool
    created_at: datetime


class TeamJoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invitation_code: str = Field(min_length=1, max_length=32)


class JoinedTeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str | None


class TeamJoinResponse(BaseModel):
    message: str
    team: JoinedTeamResponse


class TeamPlayerResponse(BaseModel):
    user_id: int
    name: str
    jersey_number: int | None
    position: PlayerPosition | None
    height_cm: int | None
    weight_kg: Decimal | None
    strengths: str | None
    weaknesses: str | None


class PlayerProfileCoachUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jersey_number: int | None = Field(default=None, ge=0, le=99)
    strengths: str | None = None
    weaknesses: str | None = None


class ExerciseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    category: ExerciseCategory | None = None
    difficulty: str | None = None
    equipment: str | None = None


class ExerciseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    category: ExerciseCategory | None
    difficulty: str | None
    equipment: str | None
    created_by: int | None
    is_public: bool


class TrainingExerciseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: int = Field(gt=0)
    duration: int | None = Field(default=None, gt=0)
    sets: int | None = Field(default=None, gt=0)
    repetitions: int | None = Field(default=None, gt=0)


class TrainingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    date: AwareDatetime
    duration: int = Field(gt=0)
    exercises: list[TrainingExerciseInput] = Field(min_length=1)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("El título no puede estar vacío")
        return title


class TrainingCreate(TrainingPayload):
    team_id: int = Field(gt=0)


class TrainingUpdate(TrainingPayload):
    pass


class TrainingListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    team_id: int
    created_by: int
    title: str
    description: str | None
    date: datetime
    duration: int
    creation_mode: TrainingCreationMode


class TrainingExerciseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_order: int
    duration: int | None
    sets: int | None
    repetitions: int | None
    exercise: ExerciseResponse


class TrainingDetailResponse(TrainingListResponse):
    exercises: list[TrainingExerciseResponse]


class TrainingAssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player_ids: list[PositiveInt] = Field(min_length=1)

    @field_validator("player_ids")
    @classmethod
    def player_ids_must_be_unique(cls, player_ids: list[int]) -> list[int]:
        if len(player_ids) != len(set(player_ids)):
            raise ValueError("La lista contiene jugadores repetidos")
        return player_ids


class TrainingAssignmentResponse(BaseModel):
    id: int
    training_id: int
    player_id: int
    player_name: str
    status: AssignmentStatus
    assigned_at: datetime
    completed_at: datetime | None


class PlayerTrainingResponse(BaseModel):
    assignment_id: int
    training_id: int
    title: str
    date: datetime
    team_id: int
    team_name: str
    status: AssignmentStatus
    assigned_at: datetime
    completed_at: datetime | None


class PlayerTrainingExerciseResponse(BaseModel):
    training_exercise_id: int
    exercise_order: int
    duration: int | None
    sets: int | None
    repetitions: int | None
    exercise: ExerciseResponse
    completed: bool
    completed_at: datetime | None


class PlayerTrainingDetailResponse(BaseModel):
    assignment_id: int
    training_id: int
    title: str
    description: str | None
    date: datetime
    duration: int
    status: AssignmentStatus
    assigned_at: datetime
    completed_at: datetime | None
    exercises: list[PlayerTrainingExerciseResponse]


class ExerciseProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed: StrictBool


class ExerciseProgressResponse(BaseModel):
    assignment_id: int
    training_exercise_id: int
    completed: bool
    completed_at: datetime | None
    assignment_status: AssignmentStatus
    assignment_completed_at: datetime | None


class TrainingPlayerProgressResponse(BaseModel):
    assignment_id: int
    player_id: int
    player_name: str
    status: AssignmentStatus
    completed_exercises: int
    total_exercises: int
    progress_percent: float
    completed_at: datetime | None
