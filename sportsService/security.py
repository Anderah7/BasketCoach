import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
import jwt
from dotenv import load_dotenv
from pwdlib import PasswordHash
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models import User

load_dotenv(Path(__file__).resolve().parent / ".env")

SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("Falta JWT_SECRET_KEY en .env")

ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 30

password_hash = PasswordHash.recommended()


def create_access_token(user_id: int) -> str:
    expiration = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)

    payload = {"sub": str(user_id), "exp": expiration}

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme), db: Session = Depends(get_db)) -> User:

    error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado", headers={"WWW-Authenticate": "Bearer"})

    if credentials is None:
        raise error

    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["sub", "exp"]})
        user_id = int(payload["sub"])

    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise error

    user = db.get(User, user_id)

    if user is None or not user.is_active:
        raise error

    return user

