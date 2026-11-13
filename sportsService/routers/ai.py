import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from ai_client import get_ai_http_client, request_ai_proposal
from ai_accept_schemas import AIExerciseAccept, AIExercisesAcceptRequest, AITrainingAcceptRequest
from ai_schemas import (
    AIAvailableExercise,
    AIGenerateRequest,
    AIGenerateResponse,
    AIPlayerContext,
    AIServiceGenerateRequest,
    ExerciseMode,
)
from database import get_db
from models import Exercise, PlayerProfile, Training, TrainingCreationMode, TrainingExercise, User, UserRole
from routers.teams import _get_coached_team
from routers.trainings import _training_detail, _validate_exercises
from schemas import ExerciseResponse, TrainingDetailResponse, TrainingExerciseInput
from security import get_current_user


router = APIRouter(prefix="/ai", tags=["AI Generation"])


def _context(text: str | None) -> str | None:
    return text.strip()[:500] if text else None


@router.post("/generate", response_model=AIGenerateResponse)
def generate_ai_proposal(
    data: AIGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    ai_client: httpx.Client = Depends(get_ai_http_client),
) -> AIGenerateResponse:
    _get_coached_team(data.team_id, current_user, db)

    player_query = select(PlayerProfile).where(PlayerProfile.team_id == data.team_id)
    if data.player_ids is not None:
        player_query = player_query.where(PlayerProfile.user_id.in_(data.player_ids))
    profiles = db.scalars(player_query.order_by(PlayerProfile.user_id)).all()
    if data.player_ids is not None and {profile.user_id for profile in profiles} != set(data.player_ids):
        raise HTTPException(status_code=404, detail="Algún jugador no pertenece al equipo")
    if len(profiles) > 30:
        raise HTTPException(status_code=422, detail="El servicio IA admite como máximo 30 jugadores")

    players = [
        AIPlayerContext(
            position=profile.position.value if profile.position else None,
            strengths=_context(profile.strengths),
            weaknesses=_context(profile.weaknesses),
        )
        for profile in profiles
    ]

    available = []
    if data.exercise_mode != ExerciseMode.NEW:
        exercises = db.scalars(
            select(Exercise)
            .where(
                or_(Exercise.is_public.is_(True), Exercise.created_by == current_user.id),
                Exercise.category.is_not(None),
            )
            .order_by(case((Exercise.created_by == current_user.id, 0), else_=1), Exercise.id)
            .limit(100)
        ).all()
        available = [
            AIAvailableExercise(
                id=exercise.id,
                name=exercise.name,
                category=exercise.category,
                description=exercise.description[:2000],
            )
            for exercise in exercises
            if exercise.name.strip() and exercise.description.strip()
        ]
    if data.exercise_mode == ExerciseMode.EXISTING and not available:
        raise HTTPException(status_code=422, detail="No hay ejercicios del catálogo disponibles para este entrenador")

    request = AIServiceGenerateRequest(
        prompt=data.prompt,
        generation_type=data.generation_type,
        duration=data.duration,
        players=players,
        available_exercises=available,
        exercise_mode=data.exercise_mode,
    )
    db.rollback()  # Read-only snapshot; release the database connection before the HTTP call.
    return request_ai_proposal(request, ai_client)


def _new_private_exercise(data: AIExerciseAccept, coach_id: int) -> Exercise:
    return Exercise(
        name=data.name,
        description=data.description,
        category=data.category,
        difficulty=data.difficulty,
        equipment=data.equipment,
        created_by=coach_id,
        is_public=False,
    )


@router.post("/exercises/accept", response_model=list[ExerciseResponse], status_code=status.HTTP_201_CREATED)
def accept_ai_exercises(
    data: AIExercisesAcceptRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403, detail="Solo los entrenadores pueden aceptar ejercicios")

    try:
        exercises = [_new_private_exercise(item, current_user.id) for item in data.exercises]
        db.add_all(exercises)
        db.flush()
        response = [ExerciseResponse.model_validate(exercise) for exercise in exercises]
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


@router.post("/trainings/accept", response_model=TrainingDetailResponse, status_code=status.HTTP_201_CREATED)
def accept_ai_training(
    data: AITrainingAcceptRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_coached_team(data.team_id, current_user, db)
    existing_items = [
        TrainingExerciseInput(
            exercise_id=item.existing_exercise_id,
            duration=item.duration,
            sets=item.sets,
            repetitions=item.repetitions,
        )
        for item in data.exercises
        if item.existing_exercise_id is not None
    ]
    existing = _validate_exercises(existing_items, current_user, db)

    try:
        training = Training(
            team_id=data.team_id,
            created_by=current_user.id,
            title=data.title,
            description=data.description,
            date=data.date,
            duration=data.duration,
            creation_mode=TrainingCreationMode.AI,
        )
        db.add(training)
        for order, item in enumerate(data.exercises, start=1):
            exercise = (
                existing[item.existing_exercise_id]
                if item.existing_exercise_id is not None
                else _new_private_exercise(item.new_exercise, current_user.id)
            )
            db.add(TrainingExercise(
                training=training,
                exercise=exercise,
                exercise_order=order,
                duration=item.duration,
                sets=item.sets,
                repetitions=item.repetitions,
            ))
        db.flush()
        response = _training_detail(training, db)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
