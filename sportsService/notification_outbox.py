"""Durable friendship events, committed with their originating PostgreSQL change."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import logging
import os
import re
from urllib.parse import urlsplit

import httpx
from sqlalchemy import DateTime, Index, Integer, JSON, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from models import Base


logger = logging.getLogger(__name__)


def utcnow():
    return datetime.now(timezone.utc)


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (Index("ix_notification_outbox_due", "delivered_at", "next_attempt_at"),)

    event_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def enqueue_friend_event(db: Session, response, event_type: str) -> None:
    accepted = event_type == "FRIEND_ACCEPTED"
    occurred = response.responded_at if accepted else response.created_at
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)
    event_id = f"friend-request:{response.id}:{event_type}"
    db.add(NotificationOutbox(event_id=event_id, payload={
        "event_id": event_id, "type": event_type,
        "actor_id": response.recipient.id if accepted else response.sender.id,
        "recipient_id": response.sender.id if accepted else response.recipient.id,
        "friend_request_id": response.id, "occurred_at": occurred.isoformat(),
    }))


def send_event(payload: dict) -> None:
    base = os.getenv("COMMUNICATION_SERVICE_URL", "").strip().rstrip("/")
    secret = os.getenv("NOTIFICATIONS_INTERNAL_SECRET", "").strip()
    url = urlsplit(base)
    if url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise ValueError("Configure COMMUNICATION_SERVICE_URL")
    if len(secret) < 32 or secret == os.getenv("AI_INTERNAL_SECRET"):
        raise ValueError("Configure a separate NOTIFICATIONS_INTERNAL_SECRET of at least 32 characters")
    with httpx.Client(timeout=3, follow_redirects=False, trust_env=False) as client:
        response = client.post(base + "/internal/notifications", json=payload, headers={"X-Notification-Secret": secret})
        response.raise_for_status()
        result = response.json()
        if response.status_code not in {200, 201} or not isinstance(result, dict) or not re.fullmatch(r"[a-f0-9]{24}", str(result.get("id", ""))) or not isinstance(result.get("duplicate"), bool):
            raise ValueError("Invalid notification service acknowledgement")


def dispatch_pending(bind=None, *, batch_size: int = 10) -> None:
    if bind is None:
        from database import engine
        bind = engine
    try:
        with Session(bind) as db:
            rows = db.scalars(select(NotificationOutbox).where(
                NotificationOutbox.delivered_at.is_(None), NotificationOutbox.next_attempt_at <= utcnow(),
            ).order_by(NotificationOutbox.next_attempt_at, NotificationOutbox.event_id)
                .limit(batch_size).with_for_update(skip_locked=True)).all()
            for row in rows:
                row.attempts += 1
                try:
                    send_event(row.payload)
                    row.delivered_at = utcnow()
                except Exception as exc:
                    row.next_attempt_at = utcnow() + timedelta(seconds=min(300, 5 * 2 ** min(row.attempts - 1, 6)))
                    logger.warning("Notification event %s pending for retry (%s)", row.event_id, type(exc).__name__)
            db.commit()
    except Exception as exc:
        # Never turn a committed friendship into a failed API response. Includes
        # database failures updating delivery status: receiver deduplication makes
        # replay safe after recovery. No headers, tokens or payloads are logged.
        logger.warning("Notification dispatcher unavailable (%s); check connectivity and Alembic migrations", type(exc).__name__)


@asynccontextmanager
async def notification_lifespan(_app):
    stop = asyncio.Event()

    async def worker():
        while not stop.is_set():
            await asyncio.to_thread(dispatch_pending)
            try:
                await asyncio.wait_for(stop.wait(), timeout=5)
            except TimeoutError:
                pass

    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        stop.set()
        await task
