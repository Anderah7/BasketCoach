import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import User, UserRole, PlayerProfile
from schemas import (
    PublicProfileResponse, UserCreate, UserResponse, UserLogin, TokenResponse,
    UserSearchResponse, UsernameUpdate,
)
from security import password_hash, create_access_token, get_current_user
from social import friendship_state, is_username_conflict, public_user


router = APIRouter(prefix="/users", tags=["Users"])


def _ensure_username_available(username: str, db: Session, *, user_id: int | None = None) -> None:
    statement = select(User.id).where(User.username == username)
    if user_id is not None:
        statement = statement.where(User.id != user_id)
    if db.scalar(statement) is not None:
        raise HTTPException(status_code=409, detail="Username is already taken")

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    email = str(data.email).strip().lower()
    name = data.name.strip()

    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name cannot be empty")

    existing_user = db.scalar(select(User).where(User.email == email))

    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    if data.username is not None:
        _ensure_username_available(data.username, db)

    new_user = User(name=name, username=data.username, email=email, password_hash=password_hash.hash(data.password), role=data.role)

    try:
        db.add(new_user)
        db.flush()

        if data.role == UserRole.PLAYER:
            db.add(PlayerProfile(user_id=new_user.id))

        db.commit()

    except IntegrityError as exc:
        db.rollback()
        if is_username_conflict(exc):
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
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


@router.patch("/me/username", response_model=UserResponse)
def update_my_username(
    data: UsernameUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.scalar(
        select(User).where(User.id == current_user.id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    _ensure_username_available(data.username, db, user_id=user.id)
    try:
        user.username = data.username
        db.flush()
        response = UserResponse.model_validate(user)
        db.commit()
        return response
    except IntegrityError as exc:
        db.rollback()
        if is_username_conflict(exc):
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/search", response_model=UserSearchResponse)
def search_users(
    username: str = Query(min_length=1, max_length=24),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fragment = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{1,24}", fragment):
        raise HTTPException(status_code=422, detail="Search usernames using letters, numbers and underscores")
    filters = (
        User.is_active.is_(True), User.username.is_not(None),
        User.username.contains(fragment, autoescape=True),
    )
    total = db.scalar(select(func.count()).select_from(User).where(*filters))
    users = db.scalars(
        select(User).where(*filters).options(joinedload(User.avatar_media))
        .order_by(User.username, User.id).offset(offset).limit(limit)
    ).all()
    return UserSearchResponse(items=[public_user(user) for user in users], total=total, limit=limit, offset=offset)


@router.get("/{user_id}/public", response_model=PublicProfileResponse)
def get_public_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.scalar(
        select(User).where(User.id == user_id, User.is_active.is_(True))
        .options(joinedload(User.avatar_media))
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    friendship_status, request_id = friendship_state(db, current_user.id, user.id)
    # No existing model flag authorizes publication of sporting details.
    # Leave these optional fields private until an explicit visibility policy exists.
    return PublicProfileResponse(
        **public_user(user).model_dump(), friendship_status=friendship_status,
        friend_request_id=request_id,
    )

