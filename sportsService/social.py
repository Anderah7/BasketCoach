"""Shared helpers for public identities and serialized friendship changes."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import FriendRequest, FriendRequestStatus, Friendship, User
from schemas import PublicUserResponse


def public_user(user: User) -> PublicUserResponse:
    return PublicUserResponse.model_validate(user)


def ordered_pair(first_id: int, second_id: int) -> tuple[int, int]:
    return min(first_id, second_id), max(first_id, second_id)


def lock_user_pair(
    db: Session, actor_id: int, other_id: int, *, require_other_active: bool = True,
) -> tuple[User, User]:
    # Every social write takes the same two user locks in ascending ID order.
    # This serializes opposite-direction requests even before a request row exists.
    users = {
        user.id: user for user in db.scalars(
            select(User).where(User.id.in_([actor_id, other_id])).order_by(User.id)
            .with_for_update().execution_options(populate_existing=True)
        )
    }
    actor = users.get(actor_id)
    other = users.get(other_id)
    if actor is None or not actor.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    if other is None or (require_other_active and not other.is_active):
        raise HTTPException(status_code=404, detail="User not found")
    return actor, other


def friendship_state(db: Session, viewer_id: int, target_id: int) -> tuple[str, int | None]:
    if viewer_id == target_id:
        return "SELF", None
    low, high = ordered_pair(viewer_id, target_id)
    if db.get(Friendship, (low, high)) is not None:
        return "FRIENDS", None
    pending = db.scalar(select(FriendRequest).where(
        FriendRequest.user_low_id == low, FriendRequest.user_high_id == high,
        FriendRequest.status == FriendRequestStatus.PENDING,
    ))
    if pending is None:
        return "NONE", None
    return ("PENDING_SENT" if pending.sender_id == viewer_id else "PENDING_RECEIVED"), pending.id


def is_unique_conflict(exc: IntegrityError) -> bool:
    return getattr(exc.orig, "sqlstate", None) == "23505" or "UNIQUE constraint failed" in str(exc.orig)


def is_username_conflict(exc: IntegrityError) -> bool:
    return (
        getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_users_username"
        or "UNIQUE constraint failed: users.username" in str(exc.orig)
    )
