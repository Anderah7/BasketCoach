from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pwdlib import PasswordHash

from database import get_db
from models import User, UserRole, PlayerProfile
from schemas import UserCreate, UserResponse


router = APIRouter(prefix="/users", tags=["Users"])

password_hash = PasswordHash.recommended()

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    email = str(data.email).strip().lower()
    name = data.name.strip()

    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name cannot be empty")

    existing_user = db.scalar(select(User).where(User.email == email))

    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    new_user = User(name=name, email=email, password_hash=password_hash.hash(data.password), role=data.role)

    try:
        db.add(new_user)
        db.flush()

        # 4. Crear perfil deportivo si es jugador
        if data.role == UserRole.PLAYER:
            db.add(PlayerProfile(user_id=new_user.id))

        # 5. Confirmar los cambios
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Conflicto al guardar el usuario"
        )

    db.refresh(new_user)
    return new_user

