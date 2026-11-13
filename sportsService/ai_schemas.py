from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models import ExerciseCategory


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


class AIGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    team_id: int = Field(gt=0)
    prompt: str = Field(min_length=1, max_length=4000)
    generation_type: GenerationType
    exercise_mode: ExerciseMode = ExerciseMode.MIXED
    duration: int | None = Field(default=None, gt=0, le=240)
    player_ids: list[int] | None = Field(default=None, max_length=30)

    @model_validator(mode="after")
    def validate_request(self):
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("El prompt no puede estar vacío")
        if self.generation_type == GenerationType.TRAINING and self.duration is None:
            raise ValueError("La duración es obligatoria para un entrenamiento")
        if self.player_ids is not None:
            if any(player_id <= 0 for player_id in self.player_ids):
                raise ValueError("Los IDs de jugadores deben ser positivos")
            if len(self.player_ids) != len(set(self.player_ids)):
                raise ValueError("No se permiten IDs de jugadores repetidos")
        return self


class AIPlayerContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: str | None = Field(default=None, max_length=50)
    strengths: str | None = Field(default=None, max_length=500)
    weaknesses: str | None = Field(default=None, max_length=500)


class AIAvailableExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=150)
    category: ExerciseCategory
    description: str = Field(min_length=1, max_length=2000)


class AIServiceGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    generation_type: GenerationType
    duration: int | None = Field(default=None, gt=0, le=240)
    players: list[AIPlayerContext] = Field(default_factory=list, max_length=30)
    available_exercises: list[AIAvailableExercise] = Field(default_factory=list, max_length=100)
    exercise_mode: ExerciseMode = ExerciseMode.MIXED


class AINewExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=20, max_length=5000)
    category: ExerciseCategory
    difficulty: str = Field(min_length=1, max_length=30)
    equipment: str = Field(min_length=1, max_length=1000)
    objective: str = Field(min_length=1, max_length=1000)


class AIProposedExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: ExerciseSource
    existing_exercise_id: int | None
    new_exercise: AINewExercise | None
    duration: int = Field(ge=1, le=240)
    sets: int = Field(ge=1, le=30)
    repetitions: int = Field(ge=1, le=100)
    rationale: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_source(self):
        if self.source == ExerciseSource.EXISTING:
            if self.existing_exercise_id is None or self.existing_exercise_id <= 0 or self.new_exercise is not None:
                raise ValueError("Un ejercicio existente requiere un ID y no datos nuevos")
        elif self.existing_exercise_id is not None or self.new_exercise is None:
            raise ValueError("Un ejercicio nuevo no puede incluir un ID existente")
        return self


class AITrainingProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    duration: int = Field(ge=1, le=240)
    exercises: list[AIProposedExercise] = Field(min_length=1, max_length=20)


class AIGenerateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_type: GenerationType
    exercises: list[AIProposedExercise] | None = None
    training: AITrainingProposal | None = None

    @model_validator(mode="after")
    def validate_shape(self):
        if self.generation_type == GenerationType.EXERCISES:
            if not self.exercises or self.training is not None or len(self.exercises) > 12:
                raise ValueError("Respuesta de ejercicios inválida")
        elif self.training is None or self.exercises is not None:
            raise ValueError("Respuesta de entrenamiento inválida")
        return self
