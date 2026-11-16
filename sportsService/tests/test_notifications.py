"""Notification delivery tests: in-memory SQLite and mocked HTTP only."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import timedelta

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from alembic.migration import MigrationContext
from alembic.operations import Operations

os.environ.setdefault("JWT_SECRET_KEY", "isolated-notification-test-jwt-secret-long-enough")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

from database import get_db
from main import app
from models import Base, FriendRequest, Friendship, User, UserRole
from notification_outbox import NotificationOutbox, dispatch_pending, send_event, utcnow
from security import create_access_token


class NotificationsCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([User(name="Private name", email=f"notify{index}@example.com", username=f"notify_{index}", password_hash="not-a-real-hash", role=UserRole.PLAYER) for index in [1, 2]])
            db.commit()
        def isolated_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = isolated_db
        self.client = TestClient(app, raise_server_exceptions=False)
        self.dispatch_patch = patch("routers.friends.dispatch_pending")
        self.dispatch = self.dispatch_patch.start()

    def tearDown(self):
        self.dispatch_patch.stop()
        self.client.close(); app.dependency_overrides.clear()
        Base.metadata.drop_all(self.engine); self.engine.dispose()

    def headers(self, user):
        return {"Authorization": f"Bearer {create_access_token(user)}"}

    def request_friend(self):
        return self.client.post("/friends/requests", json={"user_id": 2}, headers=self.headers(1))

    def test_events_are_committed_before_dispatch_and_contain_only_trusted_ids(self):
        observed = []
        def after_commit(bind):
            with Session(bind) as db:
                observed.append(db.scalar(select(func.count()).select_from(FriendRequest)))
                observed.append(db.scalar(select(func.count()).select_from(NotificationOutbox)))
        self.dispatch.side_effect = after_commit
        sent = self.request_friend()
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(observed, [1, 1])
        request_id = sent.json()["id"]
        accepted = self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(2))
        self.assertEqual(accepted.status_code, 200)
        with Session(self.engine) as db:
            rows = db.scalars(select(NotificationOutbox).order_by(NotificationOutbox.event_id)).all()
            self.assertEqual(len(rows), 2)
            by_type = {row.payload["type"]: row.payload for row in rows}
            self.assertEqual(by_type["FRIEND_REQUEST"]["actor_id"], 1)
            self.assertEqual(by_type["FRIEND_REQUEST"]["recipient_id"], 2)
            self.assertEqual(by_type["FRIEND_ACCEPTED"]["actor_id"], 2)
            self.assertEqual(by_type["FRIEND_ACCEPTED"]["recipient_id"], 1)
            self.assertNotIn("email", json.dumps(by_type))
            self.assertNotIn("Private name", json.dumps(by_type))
        self.assertEqual(self.request_friend().status_code, 409)

    def test_failed_friendship_transaction_rolls_back_the_notification_event_together(self):
        with patch.object(Session, "commit", side_effect=RuntimeError("simulated commit failure")):
            self.assertEqual(self.request_friend().status_code, 500)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(FriendRequest)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(NotificationOutbox)), 0)
        self.dispatch.assert_not_called()

    def test_offline_delivery_is_retried_without_reverting_friendship_or_changing_event_id(self):
        request_id = self.request_friend().json()["id"]
        self.assertEqual(self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(2)).status_code, 200)
        with patch("notification_outbox.send_event", side_effect=httpx.ConnectError("mock offline")):
            dispatch_pending(self.engine)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Friendship)), 1)
            pending = db.scalars(select(NotificationOutbox)).all()
            before = {row.event_id for row in pending}
            self.assertTrue(all(row.attempts == 1 and row.delivered_at is None for row in pending))
            for row in pending:
                row.next_attempt_at = utcnow() - timedelta(seconds=1)
            db.commit()
        delivered = []
        with patch("notification_outbox.send_event", side_effect=lambda payload: delivered.append(payload["event_id"])):
            dispatch_pending(self.engine)
            dispatch_pending(self.engine)
        self.assertEqual(set(delivered), before)
        self.assertEqual(len(delivered), 2)
        with Session(self.engine) as db:
            self.assertTrue(all(row.delivered_at is not None and row.attempts == 2 for row in db.scalars(select(NotificationOutbox))))

    def test_internal_http_uses_separate_secret_and_validates_acknowledgement(self):
        self.request_friend()
        with Session(self.engine) as db:
            payload = db.scalar(select(NotificationOutbox)).payload
        secret = "isolated-friend-event-secret-not-used-in-production"
        real_client = httpx.Client
        def handler(request):
            self.assertEqual(str(request.url), "http://internal.test/internal/notifications")
            self.assertEqual(request.headers["x-notification-secret"], secret)
            self.assertNotIn("authorization", request.headers)
            self.assertEqual(json.loads(request.content), payload)
            return httpx.Response(201, json={"id": "a" * 24, "duplicate": False})
        with patch.dict(os.environ, {"COMMUNICATION_SERVICE_URL": "http://internal.test", "NOTIFICATIONS_INTERNAL_SECRET": secret, "AI_INTERNAL_SECRET": "different-gemini-secret"}):
            with patch("notification_outbox.httpx.Client", side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
                send_event(payload)
            with patch.dict(os.environ, {"NOTIFICATIONS_INTERNAL_SECRET": "different-gemini-secret"}):
                with self.assertRaises(ValueError):
                    send_event(payload)

    def test_outbox_migration_creates_only_its_table_and_preserves_existing_data(self):
        isolated = create_engine("sqlite+pysqlite:///:memory:")
        path = Path(__file__).resolve().parents[1] / "alembic/versions/d4b29c7e8301_notification_outbox.py"
        spec = importlib.util.spec_from_file_location("notification_migration", path)
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        try:
            with isolated.begin() as connection:
                connection.execute(text("CREATE TABLE existing_data (id INTEGER PRIMARY KEY)"))
                connection.execute(text("INSERT INTO existing_data VALUES (1)"))
                with Operations.context(MigrationContext.configure(connection)):
                    migration.upgrade()
                self.assertIn("notification_outbox", inspect(connection).get_table_names())
                self.assertEqual(connection.scalar(text("SELECT count(*) FROM existing_data")), 1)
                with Operations.context(MigrationContext.configure(connection)):
                    migration.downgrade()
                self.assertEqual(connection.scalar(text("SELECT count(*) FROM existing_data")), 1)
        finally:
            isolated.dispose()
