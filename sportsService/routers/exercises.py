from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Exercise, User, UserRole
from schemas import ExerciseCreate, ExerciseResponse, ExerciseVisibilityUpdate
from security import get_current_user

router = APIRouter(prefix="/exercises", tags=["Exercises"])

@router.post(
    "",
    response_model=ExerciseResponse,
    status_code=status.HTTP_201_CREATED
)
def create_exercise(
    data: ExerciseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != UserRole.COACH:
        raise HTTPException(
            status_code=403,
            detail="Solo los entrenadores pueden crear ejercicios"
        )

    name = data.name.strip()

    if not name:
        raise HTTPException(
            status_code=422,
            detail="El nombre del ejercicio no puede estar vacío"
        )

    exercise_data = data.model_dump()
    exercise_data["name"] = name

    new_exercise = Exercise(
        **exercise_data,
        created_by=current_user.id,
        is_public=False
    )

    db.add(new_exercise)
    db.commit()
    db.refresh(new_exercise)

    return new_exercise


@router.get("", response_model=list[ExerciseResponse])
def get_exercises(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    exercises = db.scalars(
        select(Exercise)
        .options(selectinload(Exercise.media_assets))
        .where(
            or_(
                Exercise.is_public.is_(True),
                Exercise.created_by == current_user.id
            )
        )
        .order_by(Exercise.name)
    ).all()

    return exercises


@router.patch("/{exercise_id}/visibility", response_model=ExerciseResponse)
def update_exercise_visibility(
    exercise_id: int,
    data: ExerciseVisibilityUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403, detail="Only coaches can change exercise visibility")
    exercise = db.scalar(
        select(Exercise)
        .where(Exercise.id == exercise_id)
        .options(selectinload(Exercise.media_assets))
        .with_for_update()
    )
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    if exercise.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="You can only change the visibility of your own exercises")
    try:
        exercise.is_public = data.is_public
        db.flush()
        response = ExerciseResponse.model_validate(exercise)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
