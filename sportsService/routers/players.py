from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import PlayerProfile, Team, User, UserRole
from schemas import (
    JoinedTeamResponse,
    PlayerProfileResponse,
    PlayerProfileUpdate,
    TeamJoinRequest,
    TeamJoinResponse,
)
from security import get_current_user
from team_membership import detach_player, is_jersey_conflict

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


@router.post("/me/team", response_model=TeamJoinResponse)
def join_team(
    data: TeamJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=403, detail="Solo los jugadores pueden incorporarse a equipos")

    # La fila queda bloqueada hasta el commit para evitar dos incorporaciones simultáneas.
    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == current_user.id)
        .with_for_update()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")
    if profile.team_id is not None:
        raise HTTPException(status_code=409, detail="El jugador ya pertenece a un equipo")

    team = db.scalar(
        select(Team).where(
            Team.invitation_code == data.invitation_code,
            Team.is_managed.is_(True),
        )
    )
    if team is None:
        raise HTTPException(status_code=404, detail="Código de invitación inválido")

    if profile.jersey_number is not None:
        occupied_by = db.scalar(
            select(PlayerProfile.user_id).where(
                PlayerProfile.team_id == team.id,
                PlayerProfile.jersey_number == profile.jersey_number,
            )
        )
        if occupied_by is not None:
            raise HTTPException(status_code=409, detail="El dorsal ya está asignado en este equipo")

    profile.team = team
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if is_jersey_conflict(exc):
            raise HTTPException(status_code=409, detail="El dorsal ya está asignado en este equipo") from exc
        raise
    return TeamJoinResponse(
        message="Te has incorporado al equipo correctamente",
        team=JoinedTeamResponse.model_validate(team),
    )


@router.delete("/me/team", status_code=status.HTTP_204_NO_CONTENT)
def leave_team(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=403, detail="Solo los jugadores pueden abandonar su equipo")

    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == current_user.id)
        .with_for_update()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")
    if profile.team_id is None:
        raise HTTPException(status_code=409, detail="El jugador no pertenece a ningún equipo")

    detach_player(db, profile, profile.team_id)

