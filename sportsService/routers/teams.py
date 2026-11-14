from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import PlayerProfile, User, UserRole, Team
from schemas import (
    PlayerProfileCoachUpdate,
    TeamCreate,
    TeamPlayerResponse,
    TeamPlayerDetailResponse,
    TeamResponse,
)
from security import get_current_user
from team_membership import detach_player, is_jersey_conflict
import secrets

router = APIRouter(prefix="/teams", tags=["Teams"])

@router.post("", response_model=TeamResponse,status_code=status.HTTP_201_CREATED)
def create_team(data: TeamCreate, current_user: User = Depends(get_current_user),db: Session = Depends(get_db)):
    
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403,detail="Solo los entrenadores pueden crear equipos")


    name = data.name.strip()

    if not name:
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío")


    new_team = Team(
        name=name,
        category=data.category,
        coach_id=current_user.id,
        invitation_code=secrets.token_urlsafe(16),
        is_managed=True
    )

    try:
        db.add(new_team)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Conflicto al crear el equipo")

    db.refresh(new_team)

    return new_team

@router.get("/me", response_model=list[TeamResponse])
def get_my_teams(current_user: User = Depends(get_current_user),db: Session = Depends(get_db)):
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403,detail="Solo los entrenadores pueden consultar sus equipos")

    teams = db.scalars(select(Team).where(Team.coach_id == current_user.id,Team.is_managed.is_(True))).all()

    return teams


def _player_response(profile: PlayerProfile) -> TeamPlayerResponse:
    return TeamPlayerResponse(
        user_id=profile.user_id,
        name=profile.user.name,
        jersey_number=profile.jersey_number,
        position=profile.position,
        height_cm=profile.height_cm,
        weight_kg=profile.weight_kg,
        strengths=profile.strengths,
        weaknesses=profile.weaknesses,
        avatar_media_id=profile.user.avatar_media_id,
    )


def _get_coached_team(team_id: int, current_user: User, db: Session) -> Team:
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403, detail="Solo los entrenadores pueden gestionar jugadores")

    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Equipo no encontrado")
    if team.coach_id != current_user.id:
        raise HTTPException(status_code=403, detail="No eres el entrenador de este equipo")
    return team


@router.get("/{team_id}/players", response_model=list[TeamPlayerResponse])
def get_team_players(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_coached_team(team_id, current_user, db)
    profiles = db.scalars(
        select(PlayerProfile)
        .where(PlayerProfile.team_id == team.id)
        .options(joinedload(PlayerProfile.user).joinedload(User.avatar_media))
    ).all()
    return [_player_response(profile) for profile in profiles]


@router.get("/{team_id}/players/{player_id}", response_model=TeamPlayerDetailResponse)
def get_team_player(
    team_id: int,
    player_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(team_id, current_user, db)
    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == player_id, PlayerProfile.team_id == team_id)
        .options(joinedload(PlayerProfile.user).joinedload(User.avatar_media))
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Player not found in this team")
    return TeamPlayerDetailResponse(
        **_player_response(profile).model_dump(),
        team_id=team_id,
        birth_date=profile.birth_date,
        email=profile.user.email,
        is_active=profile.user.is_active,
        created_at=profile.user.created_at,
    )


@router.patch("/{team_id}/players/{player_id}", response_model=TeamPlayerResponse)
def update_team_player(
    team_id: int,
    player_id: int,
    data: PlayerProfileCoachUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(team_id, current_user, db)
    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == player_id)
        .options(joinedload(PlayerProfile.user).joinedload(User.avatar_media))
        .with_for_update(of=PlayerProfile)
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")
    if profile.team_id != team_id:
        raise HTTPException(status_code=403, detail="El jugador no pertenece a este equipo")

    update_data = data.model_dump(exclude_unset=True)
    jersey_number = update_data.get("jersey_number")
    if jersey_number is not None and jersey_number != profile.jersey_number:
        occupied_by = db.scalar(
            select(PlayerProfile.user_id).where(
                PlayerProfile.team_id == team_id,
                PlayerProfile.jersey_number == jersey_number,
                PlayerProfile.user_id != player_id,
            )
        )
        if occupied_by is not None:
            raise HTTPException(status_code=409, detail="El dorsal ya está asignado a otro jugador")

    for field, value in update_data.items():
        setattr(profile, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if is_jersey_conflict(exc):
            raise HTTPException(status_code=409, detail="El dorsal ya está asignado a otro jugador") from exc
        raise

    return _player_response(profile)


@router.delete("/{team_id}/players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_player(
    team_id: int,
    player_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(team_id, current_user, db)
    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == player_id)
        .with_for_update()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")
    if profile.team_id != team_id:
        raise HTTPException(status_code=403, detail="El jugador no pertenece a este equipo")

    detach_player(db, profile, team_id)
