from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ai_schemas import ExerciseSource
from models import ExerciseCategory
from schemas import ExerciseCreate, TrainingPayload


class AIExerciseAccept(ExerciseCreate):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(min_length=1, max_length=5000)
    category: ExerciseCategory
    difficulty: str | None = Field(default=None, max_length=30)
    equipment: str | None = Field(default=None, max_length=1000)
    # Present in the AI proposal; Exercise has no objective column.
    objective: str | None = Field(default=None, max_length=1000)

    @field_validator("name", "description")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El texto no puede estar vacio")
        return value

    @field_validator("difficulty", "equipment", "objective")
    @classmethod
    def optional_text(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class AIExercisesAcceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercises: list[AIExerciseAccept] = Field(min_length=1)


class AITrainingExerciseAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: ExerciseSource | None = None
    existing_exercise_id: int | None = Field(default=None, gt=0)
    new_exercise: AIExerciseAccept | None = None
    duration: int = Field(gt=0)
    sets: int = Field(gt=0)
    repetitions: int = Field(gt=0)
    rationale: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def exactly_one_exercise(self):
        if (self.existing_exercise_id is None) == (self.new_exercise is None):
            raise ValueError("Indica un ejercicio existente o uno nuevo, pero no ambos")
        if self.source is not None:
            expected = ExerciseSource.EXISTING if self.existing_exercise_id is not None else ExerciseSource.NEW
            if self.source != expected:
                raise ValueError("El origen del ejercicio no coincide con sus datos")
        return self


class AITrainingAcceptRequest(TrainingPayload):
    team_id: int = Field(gt=0)
    exercises: list[AITrainingExerciseAccept] = Field(min_length=1)
