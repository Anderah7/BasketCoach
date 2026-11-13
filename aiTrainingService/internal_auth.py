import os
import secrets
from pathlib import Path

from dotenv import dotenv_values
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader


ENV_PATH = Path(__file__).resolve().parent / ".env"
internal_secret_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)


def require_internal_secret(provided: str | None = Security(internal_secret_header)) -> None:
    file_config = dotenv_values(ENV_PATH)
    expected = (file_config.get("AI_INTERNAL_SECRET") or os.getenv("AI_INTERNAL_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Falta AI_INTERNAL_SECRET en aiTrainingService")
    if provided is None or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Acceso interno no autorizado")
