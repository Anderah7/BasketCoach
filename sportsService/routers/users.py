from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserRole, PlayerProfile
from schemas import UserCreate, UserResponse, UserLogin, TokenResponse
from security import password_hash, create_access_token, get_current_user


router = APIRouter(prefix="/users", tags=["Users"])

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

        if data.role == UserRole.PLAYER:
            db.add(PlayerProfile(user_id=new_user.id))

        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Conflicto al guardar el usuario")

    db.refresh(new_user)
    return new_user

@router.post("/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    """Copia `access_token` en Authorize de Swagger para usar las rutas protegidas."""
    email = str(data.email).strip().lower()
    user = db.scalar(select(User).where(User.email == email))

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email")

    if not password_hash.verify(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email o contraseña incorrectos", headers={"WWW-Authenticate": "Bearer"})

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario desactivado")

    token = create_access_token(user.id)

    return TokenResponse(access_token=token, token_type="bearer")


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user
    

