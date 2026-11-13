from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from database import get_db
from models import (
    Exercise,
    ExerciseProgress,
    PlayerProfile,
    AssignmentStatus,
    Training,
    TrainingAssignment,
    TrainingCreationMode,
    TrainingExercise,
    User,
    UserRole,
)
from routers.teams import _get_coached_team
from schemas import (
    TrainingCreate,
    TrainingAssignmentCreate,
    TrainingAssignmentResponse,
    TrainingDetailResponse,
    TrainingExerciseInput,
    TrainingExerciseResponse,
    TrainingListResponse,
    TrainingPlayerProgressResponse,
    TrainingUpdate,
)
from security import get_current_user


router = APIRouter(prefix="/trainings", tags=["Trainings"])


def _get_training(training_id: int, current_user: User, db: Session, *, lock: bool = False) -> Training:
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403, detail="Solo los entrenadores pueden consultar entrenamientos")

    statement = select(Training).where(Training.id == training_id)
    if lock:
        statement = statement.with_for_update()
    training = db.scalar(statement)
    if training is None:
        raise HTTPException(status_code=404, detail="Entrenamiento no encontrado")

    _get_coached_team(training.team_id, current_user, db)
    return training


def _validate_exercises(
    items: list[TrainingExerciseInput], current_user: User, db: Session
) -> dict[int, Exercise]:
    exercise_ids = {item.exercise_id for item in items}
    exercises = {
        exercise.id: exercise
        for exercise in db.scalars(select(Exercise).where(Exercise.id.in_(exercise_ids)))
    }
    for item in items:
        exercise = exercises.get(item.exercise_id)
        if exercise is None:
            raise HTTPException(status_code=404, detail=f"Ejercicio {item.exercise_id} no encontrado")
        if not exercise.is_public and exercise.created_by != current_user.id:
            raise HTTPException(status_code=403, detail=f"No puedes usar el ejercicio {item.exercise_id}")
    return exercises


def _add_exercises(
    training: Training,
    items: list[TrainingExerciseInput],
    exercises: dict[int, Exercise],
    db: Session,
) -> None:
    for order, item in enumerate(items, start=1):
        db.add(
            TrainingExercise(
                training=training,
                exercise=exercises[item.exercise_id],
                exercise_order=order,
                duration=item.duration,
                sets=item.sets,
                repetitions=item.repetitions,
            )
        )


def _training_detail(training: Training, db: Session) -> TrainingDetailResponse:
    links = db.scalars(
        select(TrainingExercise)
        .where(TrainingExercise.training_id == training.id)
        .options(joinedload(TrainingExercise.exercise).selectinload(Exercise.media_assets))
        .order_by(TrainingExercise.exercise_order)
    ).all()
    return TrainingDetailResponse(
        **TrainingListResponse.model_validate(training).model_dump(),
        exercises=[TrainingExerciseResponse.model_validate(link) for link in links],
        media_assets=training.media_assets,
    )


def _assert_editable(training: Training, db: Session) -> None:
    if training.creation_mode != TrainingCreationMode.MANUAL:
        raise HTTPException(status_code=403, detail="Solo se pueden modificar entrenamientos manuales")

    assignment_id = db.scalar(
        select(TrainingAssignment.id)
        .where(TrainingAssignment.training_id == training.id)
        .limit(1)
    )
    if assignment_id is not None:
        raise HTTPException(status_code=409, detail="El entrenamiento ya tiene asignaciones")

    progress_id = db.scalar(
        select(ExerciseProgress.id)
        .join(ExerciseProgress.training_exercise)
        .where(TrainingExercise.training_id == training.id)
        .limit(1)
    )
    if progress_id is not None:
        raise HTTPException(status_code=409, detail="El entrenamiento ya tiene progreso registrado")


def _assignment_response(assignment: TrainingAssignment) -> TrainingAssignmentResponse:
    return TrainingAssignmentResponse(
        id=assignment.id,
        training_id=assignment.training_id,
        player_id=assignment.player_id,
        player_name=assignment.player.user.name,
        status=assignment.status,
        assigned_at=assignment.assigned_at,
        completed_at=assignment.completed_at,
    )


def _is_assignment_conflict(exc: IntegrityError) -> bool:
    return (
        getattr(exc.orig, "sqlstate", None) == "23505"
        and getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        == "uq_training_player"
    )


def _assignment_conflict_detail(statuses: list[AssignmentStatus]) -> str:
    if AssignmentStatus.CANCELLED in statuses:
        return "El jugador ya tiene una asignación cancelada de este entrenamiento; no se reactiva"
    return "Algún jugador ya tiene asignado este entrenamiento"


@router.post("", response_model=TrainingDetailResponse, status_code=status.HTTP_201_CREATED)
def create_training(
    data: TrainingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(data.team_id, current_user, db)
    exercises = _validate_exercises(data.exercises, current_user, db)

    try:
        training = Training(
            team_id=data.team_id,
            created_by=current_user.id,
            title=data.title,
            description=data.description,
            date=data.date,
            duration=data.duration,
            creation_mode=TrainingCreationMode.MANUAL,
        )
        db.add(training)
        db.flush()
        _add_exercises(training, data.exercises, exercises, db)
        db.flush()
        response = _training_detail(training, db)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


@router.get("", response_model=list[TrainingListResponse])
def get_trainings(
    team_id: int = Query(gt=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(team_id, current_user, db)
    return db.scalars(
        select(Training)
        .where(Training.team_id == team_id)
        .order_by(Training.date, Training.id)
    ).all()


@router.get("/{training_id}", response_model=TrainingDetailResponse)
def get_training(
    training_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db)
    return _training_detail(training, db)


@router.put("/{training_id}", response_model=TrainingDetailResponse)
def update_training(
    training_id: int,
    data: TrainingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db, lock=True)
    _assert_editable(training, db)
    exercises = _validate_exercises(data.exercises, current_user, db)

    try:
        training.title = data.title
        training.description = data.description
        training.date = data.date
        training.duration = data.duration

        old_links = db.scalars(
            select(TrainingExercise).where(TrainingExercise.training_id == training.id)
        ).all()
        for link in old_links:
            db.delete(link)
        db.flush()

        _add_exercises(training, data.exercises, exercises, db)
        db.flush()
        response = _training_detail(training, db)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


@router.delete("/{training_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_training(
    training_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db, lock=True)
    _assert_editable(training, db)

    try:
        media_keys = [asset.storage_key for asset in training.media_assets]
        links = db.scalars(
            select(TrainingExercise).where(TrainingExercise.training_id == training.id)
        ).all()
        for link in links:
            db.delete(link)
        db.flush()
        db.delete(training)
        db.commit()
    except Exception:
        db.rollback()
        raise
    from media_store import remove_file
    for key in media_keys:
        try:
            remove_file(key)
        except OSError:
            # The database delete already committed; retain a log for file cleanup.
            import logging
            logging.getLogger(__name__).exception("Could not remove media file %s", key)


@router.post(
    "/{training_id}/assignments",
    response_model=list[TrainingAssignmentResponse],
    status_code=status.HTTP_201_CREATED,
)
def create_training_assignments(
    training_id: int,
    data: TrainingAssignmentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db, lock=True)
    requested_ids = set(data.player_ids)
    profiles = db.scalars(
        select(PlayerProfile)
        .where(PlayerProfile.user_id.in_(requested_ids))
        .order_by(PlayerProfile.user_id)
        .options(joinedload(PlayerProfile.user))
        .with_for_update(of=PlayerProfile)
    ).all()
    players_by_id = {profile.user_id: profile for profile in profiles}
    if len(players_by_id) != len(requested_ids) or any(
        profile.team_id != training.team_id for profile in profiles
    ):
        raise HTTPException(status_code=404, detail="Algún jugador no existe en el equipo")

    existing_statuses = db.scalars(
        select(TrainingAssignment.status)
        .where(
            TrainingAssignment.training_id == training_id,
            TrainingAssignment.player_id.in_(requested_ids),
        )
    ).all()
    if existing_statuses:
        raise HTTPException(status_code=409, detail=_assignment_conflict_detail(existing_statuses))

    assignments = [
        TrainingAssignment(
            training=training,
            player=players_by_id[player_id],
            status=AssignmentStatus.PENDING,
        )
        for player_id in data.player_ids
    ]
    try:
        db.add_all(assignments)
        db.flush()
        response = [_assignment_response(assignment) for assignment in assignments]
        db.commit()
        return response
    except IntegrityError as exc:
        db.rollback()
        if _is_assignment_conflict(exc):
            existing_statuses = db.scalars(
                select(TrainingAssignment.status).where(
                    TrainingAssignment.training_id == training_id,
                    TrainingAssignment.player_id.in_(requested_ids),
                )
            ).all()
            raise HTTPException(
                status_code=409,
                detail=_assignment_conflict_detail(existing_statuses),
            ) from exc
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/{training_id}/assignments", response_model=list[TrainingAssignmentResponse])
def get_training_assignments(
    training_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_training(training_id, current_user, db)
    assignments = db.scalars(
        select(TrainingAssignment)
        .where(TrainingAssignment.training_id == training_id)
        .options(joinedload(TrainingAssignment.player).joinedload(PlayerProfile.user))
        .order_by(TrainingAssignment.assigned_at, TrainingAssignment.id)
    ).all()
    return [_assignment_response(assignment) for assignment in assignments]


@router.get("/{training_id}/progress", response_model=list[TrainingPlayerProgressResponse])
def get_training_progress(
    training_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db)
    assignments = db.scalars(
        select(TrainingAssignment)
        .where(TrainingAssignment.training_id == training.id)
        .options(joinedload(TrainingAssignment.player).joinedload(PlayerProfile.user))
        .order_by(TrainingAssignment.id)
    ).all()
    if not assignments:
        return []

    total = db.scalar(
        select(func.count(TrainingExercise.id)).where(TrainingExercise.training_id == training.id)
    )
    completed_by_assignment = dict(
        db.execute(
            select(ExerciseProgress.assignment_id, func.count(ExerciseProgress.id))
            .join(ExerciseProgress.training_exercise)
            .where(
                ExerciseProgress.assignment_id.in_([assignment.id for assignment in assignments]),
                TrainingExercise.training_id == training.id,
                ExerciseProgress.completed.is_(True),
            )
            .group_by(ExerciseProgress.assignment_id)
        ).all()
    )
    return [
        TrainingPlayerProgressResponse(
            assignment_id=assignment.id,
            player_id=assignment.player_id,
            player_name=assignment.player.user.name,
            status=assignment.status,
            completed_exercises=completed_by_assignment.get(assignment.id, 0),
            total_exercises=total,
            progress_percent=round(completed_by_assignment.get(assignment.id, 0) * 100 / total, 2)
            if total else 0.0,
            completed_at=assignment.completed_at,
        )
        for assignment in assignments
    ]
