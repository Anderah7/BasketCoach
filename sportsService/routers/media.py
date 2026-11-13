import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from media_store import (
    MAX_FILES_PER_UPLOAD, MAX_MEDIA_PER_ENTITY, media_path, remove_file, store_upload,
)
from models import (
    Exercise, MediaAsset, Team, Training, TrainingAssignment, TrainingExercise, User, UserRole,
)
from routers.trainings import _get_training
from schemas import MediaAssetResponse
from security import get_current_user


router = APIRouter(tags=["Media"])
logger = logging.getLogger(__name__)


def _remove_committed_file(storage_key: str) -> None:
    try:
        remove_file(storage_key)
    except OSError:
        logger.exception("Could not remove media file %s after database commit", storage_key)


def _new_asset(stored, user_id: int, **owner: int) -> MediaAsset:
    return MediaAsset(
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        media_type=stored.media_type,
        size_bytes=stored.size_bytes,
        created_by=user_id,
        **owner,
    )


def _attach_files(
    db: Session, files: list[UploadFile], user_id: int, *,
    exercise_id: int | None = None, training_id: int | None = None,
) -> list[MediaAssetResponse]:
    if not files or len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(status_code=422, detail=f"Upload between 1 and {MAX_FILES_PER_UPLOAD} files")
    target_column = MediaAsset.exercise_id if exercise_id is not None else MediaAsset.training_id
    target_id = exercise_id if exercise_id is not None else training_id
    existing_count = db.scalar(select(func.count()).select_from(MediaAsset).where(target_column == target_id))
    if existing_count + len(files) > MAX_MEDIA_PER_ENTITY:
        raise HTTPException(status_code=409, detail=f"An item can have at most {MAX_MEDIA_PER_ENTITY} media files")

    stored_files = []
    try:
        for file in files:
            stored_files.append(store_upload(file))
        owner = {"exercise_id": exercise_id} if exercise_id is not None else {"training_id": training_id}
        assets = [_new_asset(stored, user_id, **owner) for stored in stored_files]
        db.add_all(assets)
        db.flush()
        result = [MediaAssetResponse.model_validate(asset) for asset in assets]
        db.commit()
        return result
    except Exception:
        db.rollback()
        for stored in stored_files:
            remove_file(stored.storage_key)
        raise


@router.put("/users/me/avatar", response_model=MediaAssetResponse)
def replace_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.scalar(select(User.id).where(User.id == current_user.id).with_for_update())
    old = db.scalar(select(MediaAsset).where(MediaAsset.avatar_user_id == current_user.id))
    old_key = old.storage_key if old is not None else None
    stored = store_upload(file, avatar=True)
    try:
        if old is not None:
            db.delete(old)
            db.flush()
        asset = _new_asset(stored, current_user.id, avatar_user_id=current_user.id)
        db.add(asset)
        db.flush()
        result = MediaAssetResponse.model_validate(asset)
        db.commit()
    except Exception:
        db.rollback()
        remove_file(stored.storage_key)
        raise
    if old_key is not None:
        _remove_committed_file(old_key)
    return result


@router.delete("/users/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.scalar(select(User.id).where(User.id == current_user.id).with_for_update())
    old = db.scalar(select(MediaAsset).where(MediaAsset.avatar_user_id == current_user.id))
    if old is None:
        return
    old_key = old.storage_key
    try:
        db.delete(old)
        db.commit()
    except Exception:
        db.rollback()
        raise
    _remove_committed_file(old_key)


@router.delete("/media/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Media not found")
    if asset.avatar_user_id is not None:
        if asset.avatar_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="You cannot remove this photo")
        db.scalar(select(User.id).where(User.id == current_user.id).with_for_update())
    elif asset.exercise_id is not None:
        exercise = db.scalar(select(Exercise).where(Exercise.id == asset.exercise_id).with_for_update())
        if exercise is None or exercise.created_by != current_user.id or current_user.role != UserRole.COACH:
            raise HTTPException(status_code=403, detail="You cannot remove this exercise media")
    elif asset.training_id is not None:
        training = db.get(Training, asset.training_id)
        if training is None:
            raise HTTPException(status_code=404, detail="Training not found")
        _get_training(training.id, current_user, db, lock=True)
    asset = db.scalar(select(MediaAsset).where(MediaAsset.id == asset_id).with_for_update())
    if asset is None:
        raise HTTPException(status_code=404, detail="Media not found")
    key = asset.storage_key
    try:
        db.delete(asset)
        db.commit()
    except Exception:
        db.rollback()
        raise
    _remove_committed_file(key)


@router.post("/exercises/{exercise_id}/media", response_model=list[MediaAssetResponse], status_code=201)
def add_exercise_media(
    exercise_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != UserRole.COACH:
        raise HTTPException(status_code=403, detail="Only coaches can add exercise media")
    exercise = db.scalar(select(Exercise).where(Exercise.id == exercise_id).with_for_update())
    if exercise is None:
        raise HTTPException(status_code=404, detail="Exercise not found")
    if exercise.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="You can only add media to your own exercises")
    return _attach_files(db, files, current_user.id, exercise_id=exercise.id)


@router.post("/trainings/{training_id}/media", response_model=list[MediaAssetResponse], status_code=201)
def add_training_media(
    training_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    training = _get_training(training_id, current_user, db, lock=True)
    return _attach_files(db, files, current_user.id, training_id=training.id)


@router.get("/media/{asset_id}")
def read_media(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Media not found")

    allowed = asset.avatar_user_id is not None
    if asset.exercise_id is not None:
        exercise = db.get(Exercise, asset.exercise_id)
        allowed = bool(exercise and (exercise.is_public or exercise.created_by == current_user.id))
        if not allowed and current_user.role == UserRole.PLAYER:
            allowed = db.scalar(
                select(TrainingAssignment.id)
                .join(TrainingExercise, TrainingExercise.training_id == TrainingAssignment.training_id)
                .where(
                    TrainingAssignment.player_id == current_user.id,
                    TrainingExercise.exercise_id == asset.exercise_id,
                ).limit(1)
            ) is not None
    if asset.training_id is not None:
        training = db.get(Training, asset.training_id)
        if training is not None and current_user.role == UserRole.COACH:
            team = db.get(Team, training.team_id)
            allowed = bool(team and team.coach_id == current_user.id)
        elif current_user.role == UserRole.PLAYER:
            allowed = db.scalar(
                select(TrainingAssignment.id).where(
                    TrainingAssignment.training_id == asset.training_id,
                    TrainingAssignment.player_id == current_user.id,
                ).limit(1)
            ) is not None
    if not allowed:
        raise HTTPException(status_code=403, detail="You cannot access this media")

    path = media_path(asset.storage_key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")
    return FileResponse(
        path, media_type=asset.content_type,
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )
