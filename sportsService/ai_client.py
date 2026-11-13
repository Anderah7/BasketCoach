import os
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import dotenv_values
from fastapi import HTTPException
from pydantic import ValidationError

from ai_schemas import (
    AIGenerateResponse,
    AIServiceGenerateRequest,
    ExerciseMode,
    ExerciseSource,
    GenerationType,
)


ENV_PATH = Path(__file__).resolve().parent / ".env"


def get_ai_http_client():
    with httpx.Client(timeout=35.0) as client:
        yield client


def _settings() -> tuple[str, str]:
    file_config = dotenv_values(ENV_PATH)
    base_url = (file_config.get("AI_TRAINING_SERVICE_URL") or os.getenv("AI_TRAINING_SERVICE_URL") or "").strip()
    secret = (file_config.get("AI_INTERNAL_SECRET") or os.getenv("AI_INTERNAL_SECRET") or "").strip()
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not secret:
        raise HTTPException(status_code=503, detail="Configura AI_TRAINING_SERVICE_URL y AI_INTERNAL_SECRET")
    return base_url.rstrip("/"), secret


def _validate_response(
    proposal: AIGenerateResponse,
    request: AIServiceGenerateRequest,
) -> None:
    if proposal.generation_type != request.generation_type:
        raise HTTPException(status_code=502, detail="El servicio IA devolvió un tipo de generación distinto")

    exercises = proposal.exercises if proposal.generation_type == GenerationType.EXERCISES else proposal.training.exercises
    allowed_ids = {exercise.id for exercise in request.available_exercises}
    for exercise in exercises:
        if exercise.source == ExerciseSource.EXISTING:
            if request.exercise_mode == ExerciseMode.NEW or exercise.existing_exercise_id not in allowed_ids:
                raise HTTPException(status_code=502, detail="El servicio IA devolvió un ejercicio no autorizado")
        elif request.exercise_mode == ExerciseMode.EXISTING:
            raise HTTPException(status_code=502, detail="El servicio IA devolvió un ejercicio nuevo no solicitado")

    if proposal.training is not None and proposal.training.duration != request.duration:
        raise HTTPException(status_code=502, detail="La duración del entrenamiento propuesto no coincide")
    if request.duration is not None:
        minutes = sum(exercise.duration for exercise in exercises)
        if not request.duration * 0.8 <= minutes <= request.duration:
            raise HTTPException(status_code=502, detail="La duración de los ejercicios propuestos es incoherente")


def request_ai_proposal(request: AIServiceGenerateRequest, client: httpx.Client) -> AIGenerateResponse:
    base_url, secret = _settings()
    try:
        response = client.post(
            f"{base_url}/generate",
            json=request.model_dump(mode="json"),
            headers={"X-Internal-Secret": secret},
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="El servicio IA tardó demasiado") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="No se pudo contactar con el servicio IA") from exc

    if response.status_code != 200:
        if response.status_code in (401, 403):
            raise HTTPException(status_code=503, detail="La autenticación interna con el servicio IA falló")
        if response.status_code in (422, 429, 502, 503, 504):
            try:
                detail = response.json().get("detail")
            except (ValueError, AttributeError):
                detail = None
            if not isinstance(detail, str) or len(detail) > 500:
                detail = "El servicio IA no pudo generar la propuesta"
            raise HTTPException(status_code=response.status_code, detail=detail)
        raise HTTPException(status_code=502, detail=f"El servicio IA devolvió HTTP {response.status_code}")

    try:
        proposal = AIGenerateResponse.model_validate(response.json())
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=502, detail="El servicio IA devolvió una respuesta inválida") from exc
    _validate_response(proposal, request)
    return proposal
