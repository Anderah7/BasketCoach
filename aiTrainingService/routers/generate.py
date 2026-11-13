from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from internal_auth import require_internal_secret
from llm import (
    LLMConfigurationError,
    LLMInvalidResponseError,
    LLMQuotaError,
    LLMRefusalError,
    LLMRequestError,
    LLMTimeoutError,
    LLMUnavailableError,
    GeminiProposalProvider,
    get_provider,
)
from schemas import (
    ExerciseMode,
    ExerciseSource,
    ExercisesProposal,
    GenerateRequest,
    GenerateResponse,
    GenerationType,
    TrainingProposal,
)


router = APIRouter(tags=["Generación con IA"])


def _validate_proposal(request: GenerateRequest, proposal: ExercisesProposal | TrainingProposal) -> None:
    exercises = proposal.exercises
    allowed_ids = {exercise.id for exercise in request.available_exercises}

    for exercise in exercises:
        if exercise.source == ExerciseSource.EXISTING:
            if request.exercise_mode == ExerciseMode.NEW or exercise.existing_exercise_id not in allowed_ids:
                raise LLMInvalidResponseError("El proveedor propuso un ejercicio existente no permitido")
        elif request.exercise_mode == ExerciseMode.EXISTING:
            raise LLMInvalidResponseError("El proveedor propuso un ejercicio nuevo en modo EXISTING")

    if request.generation_type == GenerationType.TRAINING and proposal.duration != request.duration:
        raise LLMInvalidResponseError("La duración propuesta no coincide con la solicitada")

    if request.duration is not None:
        exercise_minutes = sum(exercise.duration for exercise in exercises)
        if not (request.duration * 0.8 <= exercise_minutes <= request.duration):
            raise LLMInvalidResponseError("Las duraciones de los ejercicios no son coherentes")


@router.post("/generate", response_model=GenerateResponse)
def generate(
    request: GenerateRequest,
    _: None = Depends(require_internal_secret),
    provider: GeminiProposalProvider = Depends(get_provider),
) -> GenerateResponse:
    try:
        proposal = provider.generate(request)
        if request.generation_type == GenerationType.EXERCISES:
            proposal = ExercisesProposal.model_validate(proposal)
        else:
            proposal = TrainingProposal.model_validate(proposal)
        _validate_proposal(request, proposal)
    except LLMConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except LLMTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except LLMQuotaError as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    except LLMRequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except LLMRefusalError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except LLMInvalidResponseError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="El proveedor devolvió una propuesta inválida",
        ) from exc

    if request.generation_type == GenerationType.EXERCISES:
        return GenerateResponse(generation_type=request.generation_type, exercises=proposal.exercises)
    return GenerateResponse(generation_type=request.generation_type, training=proposal)
