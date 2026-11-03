from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserRole, PlayerProfile
from schemas import PlayerProfileUpdate, PlayerProfileResponse
from security import get_current_user

router = APIRouter(prefix="/players", tags=["Players"])

@router.get("/me", response_model=PlayerProfileResponse)
def get_my_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo los jugadores pueden acceder a este perfil")

    profile = db.get(PlayerProfile, current_user.id)

    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil deportivo no encontrado")

    return profile


@router.patch("/me", response_model=PlayerProfileResponse)
def update_my_profile(data: PlayerProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,detail="Solo los jugadores pueden modificar su perfil")

    profile = db.get(PlayerProfile, current_user.id)

    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil deportivo no encontrado")

    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)

    return profile

