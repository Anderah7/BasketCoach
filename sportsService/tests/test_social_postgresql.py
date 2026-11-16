"""Real PostgreSQL concurrency checks, enabled only for an explicitly isolated local database."""

import importlib.util
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from dotenv import dotenv_values
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.test_social import IsolatedSocialCase
from models import Base, FriendRequest, FriendRequestStatus, Friendship, User
from routers import friends, users


TEST_URL = os.getenv("BASKETCOACH_TEST_DATABASE_URL")


@unittest.skipUnless(TEST_URL, "Set BASKETCOACH_TEST_DATABASE_URL to an isolated local PostgreSQL database")
class PostgreSQLSocialTests(IsolatedSocialCase):
    def make_engine(self):
        url = make_url(TEST_URL)
        real_name = dotenv_values(Path(__file__).parents[1] / ".env").get("DB_NAME")
        if (
            url.get_backend_name() != "postgresql" or url.host not in {"127.0.0.1", "localhost"}
            or not url.database or not url.database.startswith("basketcoach_")
            or not url.database.endswith("_test") or url.database in {real_name, os.getenv("DB_NAME")}
        ):
            raise RuntimeError("Refusing to run destructive test setup outside an isolated local basketcoach_*_test database")
        engine = create_engine(url, connect_args={"connect_timeout": 3})
        Base.metadata.drop_all(engine)
        return engine

    def run_simultaneously(self, actions, *, lock_target=None):
        barrier = Barrier(2)
        if lock_target:
            original = friends.lock_user_pair
            def synchronized(*args, **kwargs):
                barrier.wait(timeout=10)
                return original(*args, **kwargs)
            context = patch("routers.friends.lock_user_pair", side_effect=synchronized)
        else:
            original = users._ensure_username_available
            def synchronized(*args, **kwargs):
                original(*args, **kwargs)
                barrier.wait(timeout=10)
            context = patch("routers.users._ensure_username_available", side_effect=synchronized)
        with context, ThreadPoolExecutor(max_workers=2) as executor:
            jobs = [executor.submit(action) for action in actions]
            return [job.result(timeout=20) for job in jobs]

    def test_simultaneous_username_changes_have_one_winner(self):
        responses = self.run_simultaneously([
            lambda: self.client.patch("/users/me/username", json={"username": "SAME_ALIAS"}, headers=self.headers(self.coach)),
            lambda: self.client.patch("/users/me/username", json={"username": "same_alias"}, headers=self.headers(self.player)),
        ])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(User).where(User.username == "same_alias")), 1)

    def test_simultaneous_registrations_have_one_username_winner(self):
        def register(email, alias):
            return self.client.post("/users/register", json={
                "name": "Registered in isolation", "email": email, "password": "test-password",
                "role": "fan", "username": alias,
            })
        responses = self.run_simultaneously([
            lambda: register("first-race@example.com", "RACE_ALIAS"),
            lambda: register("second-race@example.com", "race_alias"),
        ])
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(User).where(User.username == "race_alias")), 1)

    def test_simultaneous_duplicate_requests_create_one_pending_row(self):
        responses = self.run_simultaneously([lambda: self.send(), lambda: self.send()], lock_target=True)
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(FriendRequest)), 1)

    def test_simultaneous_crossed_requests_create_one_pending_row(self):
        responses = self.run_simultaneously([
            lambda: self.send(), lambda: self.send(self.player, self.coach),
        ], lock_target=True)
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(FriendRequest)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(Friendship)), 0)

    def test_simultaneous_acceptance_creates_one_friendship(self):
        request_id = self.send().json()["id"]
        action = lambda: self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(self.player))
        responses = self.run_simultaneously([action, action], lock_target=True)
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Friendship)), 1)

    def test_simultaneous_acceptance_and_rejection_keep_consistent_state(self):
        request_id = self.send().json()["id"]
        responses = self.run_simultaneously([
            lambda: self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(self.player)),
            lambda: self.client.post(f"/friends/requests/{request_id}/reject", headers=self.headers(self.player)),
        ], lock_target=True)
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        with Session(self.engine) as db:
            request = db.get(FriendRequest, request_id)
            self.assertIsNotNone(request.responded_at)
            count = db.scalar(select(func.count()).select_from(Friendship))
            self.assertEqual(count, 1 if request.status == FriendRequestStatus.ACCEPTED else 0)

    def test_simultaneous_removal_and_new_request_do_not_coexist_with_friendship(self):
        request_id = self.send().json()["id"]
        self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(self.player))
        responses = self.run_simultaneously([
            lambda: self.client.delete(f"/friends/{self.player}", headers=self.headers(self.coach)),
            lambda: self.send(self.player, self.coach),
        ], lock_target=True)
        self.assertEqual(responses[0].status_code, 204)
        self.assertIn(responses[1].status_code, (201, 409))
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Friendship)), 0)
            pending = db.scalar(select(func.count()).select_from(FriendRequest).where(FriendRequest.status == FriendRequestStatus.PENDING))
            self.assertEqual(pending, 1 if responses[1].status_code == 201 else 0)

    def test_postgresql_constraints_protect_pairs_and_username_characters(self):
        self.send()
        with Session(self.engine) as db:
            db.add(FriendRequest(sender_id=self.player, recipient_id=self.coach, user_low_id=self.coach, user_high_id=self.player))
            with self.assertRaises(IntegrityError) as error:
                db.commit()
            self.assertEqual(error.exception.orig.diag.constraint_name, "uq_friend_requests_pending_pair")
            db.rollback()
        for alias in ("MixedCase", "abc!", "álias"):
            with Session(self.engine) as db:
                db.get(User, self.other).username = alias
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()

    def test_migration_preserves_existing_users_and_generates_no_aliases(self):
        path = Path(__file__).parents[1] / "alembic/versions/c7a943e51b20_usernames_and_friendships.py"
        spec = importlib.util.spec_from_file_location("social_migration_under_test", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with self.engine.begin() as connection:
            statement = text("SELECT id, name, email, password_hash, role, is_active, created_at FROM users ORDER BY id")
            before = connection.execute(statement).all()
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                migration.upgrade()
            self.assertEqual(connection.execute(statement).all(), before)
            self.assertTrue(all(value is None for value in connection.execute(text("SELECT username FROM users")).scalars()))
            self.assertEqual(connection.scalar(text("SELECT count(*) FROM friend_requests")), 0)
            self.assertEqual(connection.scalar(text("SELECT count(*) FROM friendships")), 0)


if __name__ == "__main__":
    unittest.main()
