from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import case, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import FriendRequest, FriendRequestStatus, Friendship, User
from schemas import (
    FriendRequestCreate, FriendRequestResponse, FriendRequestsResponse, FriendResponse,
)
from security import get_current_user
from social import is_unique_conflict, lock_user_pair, ordered_pair, public_user
from notification_outbox import enqueue_friend_event, dispatch_pending


router = APIRouter(prefix="/friends", tags=["Friends"])


def _request_response(friend_request: FriendRequest) -> FriendRequestResponse:
    return FriendRequestResponse(
        id=friend_request.id,
        sender=public_user(friend_request.sender), recipient=public_user(friend_request.recipient),
        status=friend_request.status, created_at=friend_request.created_at,
        responded_at=friend_request.responded_at,
    )


@router.post("/requests", response_model=FriendRequestResponse, status_code=status.HTTP_201_CREATED)
def send_friend_request(
    data: FriendRequestCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.user_id == current_user.id:
        raise HTTPException(status_code=409, detail="You cannot send a friend request to yourself")
    actor, other = lock_user_pair(db, current_user.id, data.user_id)
    low, high = ordered_pair(actor.id, other.id)
    if db.get(Friendship, (low, high)) is not None:
        raise HTTPException(status_code=409, detail="You are already friends")
    pending = db.scalar(select(FriendRequest).where(
        FriendRequest.user_low_id == low, FriendRequest.user_high_id == high,
        FriendRequest.status == FriendRequestStatus.PENDING,
    ))
    if pending is not None:
        detail = "A friend request is already pending" if pending.sender_id == actor.id else "This user already sent you a request; accept or reject the received request"
        raise HTTPException(status_code=409, detail=detail)
    friend_request = FriendRequest(
        sender=actor, recipient=other, user_low_id=low, user_high_id=high,
        status=FriendRequestStatus.PENDING,
    )
    try:
        db.add(friend_request)
        db.flush()
        response = _request_response(friend_request)
        enqueue_friend_event(db, response, "FRIEND_REQUEST")
        db.commit()
        background_tasks.add_task(dispatch_pending, db.get_bind())
        return response
    except IntegrityError as exc:
        db.rollback()
        if is_unique_conflict(exc):
            raise HTTPException(status_code=409, detail="A friend request is already pending") from exc
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/requests", response_model=FriendRequestsResponse)
def get_friend_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    requests = db.scalars(
        select(FriendRequest)
        .where(or_(FriendRequest.sender_id == current_user.id, FriendRequest.recipient_id == current_user.id))
        .options(
            joinedload(FriendRequest.sender).joinedload(User.avatar_media),
            joinedload(FriendRequest.recipient).joinedload(User.avatar_media),
        )
        .order_by(FriendRequest.created_at.desc(), FriendRequest.id.desc())
    ).all()
    return FriendRequestsResponse(
        sent=[_request_response(item) for item in requests if item.sender_id == current_user.id],
        received=[_request_response(item) for item in requests if item.recipient_id == current_user.id],
    )


def _respond_to_request(
    request_id: int, current_user: User, db: Session, *, accept: bool, background_tasks: BackgroundTasks | None = None,
) -> FriendRequestResponse:
    friend_request = db.get(FriendRequest, request_id)
    if friend_request is None:
        raise HTTPException(status_code=404, detail="Friend request not found")
    if friend_request.recipient_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the recipient can respond to this request")
    lock_user_pair(db, current_user.id, friend_request.sender_id, require_other_active=accept)
    friend_request = db.scalar(
        select(FriendRequest).where(FriendRequest.id == request_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if friend_request.status != FriendRequestStatus.PENDING:
        raise HTTPException(status_code=409, detail="This friend request has already been answered")
    try:
        if accept:
            pair = (friend_request.user_low_id, friend_request.user_high_id)
            if db.get(Friendship, pair) is not None:
                raise HTTPException(status_code=409, detail="You are already friends")
            db.add(Friendship(user_low_id=pair[0], user_high_id=pair[1]))
        friend_request.status = FriendRequestStatus.ACCEPTED if accept else FriendRequestStatus.REJECTED
        friend_request.responded_at = datetime.now(timezone.utc)
        db.flush()
        response = _request_response(friend_request)
        if accept:
            enqueue_friend_event(db, response, "FRIEND_ACCEPTED")
        db.commit()
        if accept and background_tasks is not None:
            background_tasks.add_task(dispatch_pending, db.get_bind())
        return response
    except IntegrityError as exc:
        db.rollback()
        if is_unique_conflict(exc):
            raise HTTPException(status_code=409, detail="This friendship already exists") from exc
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/requests/{request_id}/accept", response_model=FriendRequestResponse)
def accept_friend_request(
    request_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _respond_to_request(request_id, current_user, db, accept=True, background_tasks=background_tasks)


@router.post("/requests/{request_id}/reject", response_model=FriendRequestResponse)
def reject_friend_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _respond_to_request(request_id, current_user, db, accept=False)


@router.get("", response_model=list[FriendResponse])
def get_friends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    other_id = case(
        (Friendship.user_low_id == current_user.id, Friendship.user_high_id),
        else_=Friendship.user_low_id,
    )
    friends = db.execute(
        select(User, Friendship.created_at)
        .join(Friendship, User.id == other_id)
        .where(
            or_(Friendship.user_low_id == current_user.id, Friendship.user_high_id == current_user.id),
            User.is_active.is_(True),
        )
        .options(joinedload(User.avatar_media))
        .order_by(User.username.asc().nulls_last(), User.id)
    ).all()
    return [FriendResponse(**public_user(user).model_dump(), friends_since=created_at) for user, created_at in friends]


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_friendship(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=404, detail="Friendship not found")
    lock_user_pair(db, current_user.id, user_id, require_other_active=False)
    low, high = ordered_pair(current_user.id, user_id)
    friendship = db.scalar(select(Friendship).where(
        Friendship.user_low_id == low, Friendship.user_high_id == high,
    ).with_for_update())
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friendship not found")
    try:
        db.delete(friendship)
        db.commit()
    except Exception:
        db.rollback()
        raise
