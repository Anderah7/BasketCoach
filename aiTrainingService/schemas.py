from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GenerationType(str, Enum):
    EXERCISES = "EXERCISES"
    TRAINING = "TRAINING"


class ExerciseMode(str, Enum):
    EXISTING = "EXISTING"
    NEW = "NEW"
    MIXED = "MIXED"


class ExerciseSource(str, Enum):
    EXISTING = "EXISTING"
    NEW = "NEW"


# Keep these values aligned with sportsService.models.ExerciseCategory.
class ExerciseCategory(str, Enum):
    SHOOTING = "Shooting"
    DEFENSE = "Defense"
    PHYSICAL = "Physical"
    BALL_HANDLING = "Ball handling"
    PASSING = "Passing"
    REBOUNDING = "Rebounding"
    TACTICS = "Tactics"


class PlayerContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: str | None = Field(default=None, max_length=50)
    strengths: str | None = Field(default=None, max_length=500)
    weaknesses: str | None = Field(default=None, max_length=500)


class AvailableExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=150)
    category: ExerciseCategory
    description: str = Field(min_length=1, max_length=2000)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    generation_type: GenerationType
    duration: int | None = Field(default=None, gt=0, le=240)
    players: list[PlayerContext] = Field(default_factory=list, max_length=30)
    available_exercises: list[AvailableExercise] = Field(default_factory=list, max_length=100)
    exercise_mode: ExerciseMode = ExerciseMode.MIXED

    @model_validator(mode="after")
    def check_request(self):
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("El prompt no puede estar vacío")
        if self.generation_type == GenerationType.TRAINING and self.duration is None:
            raise ValueError("La duración es obligatoria para un entrenamiento")
        if self.exercise_mode == ExerciseMode.EXISTING and not self.available_exercises:
            raise ValueError("El modo EXISTING requiere ejercicios disponibles")
        ids = [exercise.id for exercise in self.available_exercises]
        if len(ids) != len(set(ids)):
            raise ValueError("El catálogo contiene IDs repetidos")
        return self


class NewExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=20, max_length=5000)
    category: ExerciseCategory
    difficulty: str = Field(min_length=1, max_length=30)
    equipment: str = Field(min_length=1, max_length=1000)
    objective: str = Field(min_length=1, max_length=1000)


class ProposedExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: ExerciseSource
    existing_exercise_id: int | None
    new_exercise: NewExercise | None
    duration: int = Field(ge=1, le=240)
    sets: int = Field(ge=1, le=30)
    repetitions: int = Field(ge=1, le=100)
    rationale: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def check_source(self):
        if self.source == ExerciseSource.EXISTING:
            if self.existing_exercise_id is None or self.existing_exercise_id <= 0 or self.new_exercise is not None:
                raise ValueError("Un ejercicio existente necesita un ID y no datos nuevos")
        elif self.existing_exercise_id is not None or self.new_exercise is None:
            raise ValueError("Un ejercicio nuevo no puede tener ID de catálogo")
        return self


class ExercisesProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercises: list[ProposedExercise] = Field(min_length=1, max_length=12)


class TrainingProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    duration: int = Field(ge=1, le=240)
    exercises: list[ProposedExercise] = Field(
        min_length=1,
        max_length=20,
        description="El orden de esta lista será exercise_order cuando sportsService guarde la propuesta.",
    )


class GenerateResponse(BaseModel):
    generation_type: GenerationType
    exercises: list[ProposedExercise] | None = None
    training: TrainingProposal | None = None
