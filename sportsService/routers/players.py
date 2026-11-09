from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import (
    AssignmentStatus,
    ExerciseProgress,
    PlayerProfile,
    Team,
    Training,
    TrainingAssignment,
    TrainingExercise,
    User,
    UserRole,
)
from schemas import (
    ExerciseProgressResponse,
    ExerciseProgressUpdate,
    JoinedTeamResponse,
    PlayerTrainingDetailResponse,
    PlayerTrainingExerciseResponse,
    PlayerTrainingResponse,
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


@router.get("/me/trainings", response_model=list[PlayerTrainingResponse])
def get_my_trainings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=403, detail="Solo los jugadores pueden consultar sus entrenamientos")
    if db.get(PlayerProfile, current_user.id) is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")

    assignments = db.scalars(
        select(TrainingAssignment)
        .join(TrainingAssignment.training)
        .where(TrainingAssignment.player_id == current_user.id)
        .options(joinedload(TrainingAssignment.training).joinedload(Training.team))
        .order_by(Training.date, Training.id, TrainingAssignment.id)
    ).all()
    return [
        PlayerTrainingResponse(
            assignment_id=assignment.id,
            training_id=assignment.training_id,
            title=assignment.training.title,
            date=assignment.training.date,
            team_id=assignment.training.team_id,
            team_name=assignment.training.team.name,
            status=assignment.status,
            assigned_at=assignment.assigned_at,
            completed_at=assignment.completed_at,
        )
        for assignment in assignments
    ]


def _get_my_assignment(
    assignment_id: int, current_user: User, db: Session, *, lock: bool = False
) -> TrainingAssignment:
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=403, detail="Solo los jugadores pueden consultar sus entrenamientos")
    statement = select(TrainingAssignment).where(
        TrainingAssignment.id == assignment_id,
        TrainingAssignment.player_id == current_user.id,
    )
    if lock:
        statement = statement.with_for_update()
    assignment = db.scalar(statement)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    return assignment


def _is_progress_conflict(exc: IntegrityError) -> bool:
    return (
        getattr(exc.orig, "sqlstate", None) == "23505"
        and getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        == "uq_assignment_exercise"
    )


@router.get("/me/trainings/{assignment_id}", response_model=PlayerTrainingDetailResponse)
def get_my_training_detail(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assignment = _get_my_assignment(assignment_id, current_user, db)
    training = assignment.training
    exercises = db.scalars(
        select(TrainingExercise)
        .where(TrainingExercise.training_id == training.id)
        .options(joinedload(TrainingExercise.exercise))
        .order_by(TrainingExercise.exercise_order)
    ).all()
    progress_by_exercise = {
        progress.training_exercise_id: progress
        for progress in db.scalars(
            select(ExerciseProgress).where(ExerciseProgress.assignment_id == assignment.id)
        )
    }
    return PlayerTrainingDetailResponse(
        assignment_id=assignment.id,
        training_id=training.id,
        title=training.title,
        description=training.description,
        date=training.date,
        duration=training.duration,
        status=assignment.status,
        assigned_at=assignment.assigned_at,
        completed_at=assignment.completed_at,
        exercises=[
            PlayerTrainingExerciseResponse(
                training_exercise_id=link.id,
                exercise_order=link.exercise_order,
                duration=link.duration,
                sets=link.sets,
                repetitions=link.repetitions,
                exercise=link.exercise,
                completed=progress_by_exercise.get(link.id).completed
                if link.id in progress_by_exercise else False,
                completed_at=progress_by_exercise.get(link.id).completed_at
                if link.id in progress_by_exercise else None,
            )
            for link in exercises
        ],
    )


@router.patch(
    "/me/trainings/{assignment_id}/exercises/{training_exercise_id}",
    response_model=ExerciseProgressResponse,
)
def update_my_exercise_progress(
    assignment_id: int,
    training_exercise_id: int,
    data: ExerciseProgressUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.PLAYER:
        raise HTTPException(status_code=403, detail="Solo los jugadores pueden actualizar su progreso")

    # El mismo bloqueo lo usa la salida del equipo: no se modifica un historial ya separado.
    profile = db.scalar(
        select(PlayerProfile)
        .where(PlayerProfile.user_id == current_user.id)
        .with_for_update()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Perfil deportivo no encontrado")
    assignment = _get_my_assignment(assignment_id, current_user, db, lock=True)
    if assignment.status == AssignmentStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="La asignación está cancelada")
    if profile.team_id != assignment.training.team_id:
        raise HTTPException(status_code=409, detail="La asignación pertenece a un equipo anterior")

    exercise = db.scalar(
        select(TrainingExercise).where(
            TrainingExercise.id == training_exercise_id,
            TrainingExercise.training_id == assignment.training_id,
        )
    )
    if exercise is None:
        raise HTTPException(status_code=404, detail="Ejercicio no encontrado en este entrenamiento")

    progress = db.scalar(
        select(ExerciseProgress).where(
            ExerciseProgress.assignment_id == assignment.id,
            ExerciseProgress.training_exercise_id == training_exercise_id,
        )
    )
    now = datetime.now(timezone.utc)
    try:
        if progress is None and data.completed:
            progress = ExerciseProgress(
                assignment=assignment,
                training_exercise=exercise,
                completed=True,
                completed_at=now,
            )
            db.add(progress)
        elif progress is not None:
            if data.completed and (not progress.completed or progress.completed_at is None):
                progress.completed = True
                progress.completed_at = now
            elif not data.completed:
                progress.completed = False
                progress.completed_at = None

        db.flush()
        total = db.scalar(
            select(func.count(TrainingExercise.id)).where(
                TrainingExercise.training_id == assignment.training_id
            )
        )
        completed_count = db.scalar(
            select(func.count(ExerciseProgress.id))
            .join(ExerciseProgress.training_exercise)
            .where(
                ExerciseProgress.assignment_id == assignment.id,
                TrainingExercise.training_id == assignment.training_id,
                ExerciseProgress.completed.is_(True),
            )
        )
        if completed_count == 0:
            assignment.status = AssignmentStatus.PENDING
            assignment.completed_at = None
        elif completed_count == total:
            if assignment.status != AssignmentStatus.COMPLETED or assignment.completed_at is None:
                assignment.completed_at = now
            assignment.status = AssignmentStatus.COMPLETED
        else:
            assignment.status = AssignmentStatus.IN_PROGRESS
            assignment.completed_at = None

        response = ExerciseProgressResponse(
            assignment_id=assignment.id,
            training_exercise_id=training_exercise_id,
            completed=progress.completed if progress is not None else False,
            completed_at=progress.completed_at if progress is not None else None,
            assignment_status=assignment.status,
            assignment_completed_at=assignment.completed_at,
        )
        db.commit()
        return response
    except IntegrityError as exc:
        db.rollback()
        if _is_progress_conflict(exc):
            raise HTTPException(status_code=409, detail="El progreso del ejercicio ya existe") from exc
        raise
    except Exception:
        db.rollback()
        raise

