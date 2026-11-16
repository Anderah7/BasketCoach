import os
import unittest
from datetime import date
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-for-isolated-tests")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

from database import get_db
from main import app
from models import (
    Base, FriendRequest, FriendRequestStatus, Friendship, MediaAsset, PlayerPosition,
    PlayerProfile, Team, User, UserRole,
)
from security import create_access_token


class IsolatedSocialCase(unittest.TestCase):
    def make_engine(self):
        engine = create_engine(
            "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        return engine

    def setUp(self):
        dispatcher = patch("routers.friends.dispatch_pending")
        dispatcher.start()
        self.addCleanup(dispatcher.stop)
        self.engine = self.make_engine()
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            users = [
                User(name="Private Coach Name", email="coach-social@example.com", username="coach_one", password_hash="private_hash", role=UserRole.COACH),
                User(name="Private Player Name", email="player-social@example.com", username="player_one", password_hash="private_hash", role=UserRole.PLAYER),
                User(name="Private Fan Name", email="fan-social@example.com", username="coach_two", password_hash="private_hash", role=UserRole.FAN),
                User(name="Legacy Private Name", email="legacy-social@example.com", password_hash="private_hash", role=UserRole.FAN),
                User(name="Inactive Private Name", email="inactive-social@example.com", username="coach_inactive", password_hash="private_hash", role=UserRole.FAN, is_active=False),
                User(name="Another Private Name", email="other-social@example.com", username="coachxone", password_hash="private_hash", role=UserRole.FAN),
            ]
            db.add_all(users)
            db.flush()
            team = Team(name="Private Team", coach_id=users[0].id, invitation_code="private-code")
            db.add(team)
            db.flush()
            db.add(PlayerProfile(
                user_id=users[1].id, team_id=team.id, position=PlayerPosition.POINT_GUARD,
                jersey_number=7, height_cm=185, weight_kg=80, birth_date=date(2000, 1, 2),
                strengths="Private strengths", weaknesses="Private weaknesses",
            ))
            avatar = MediaAsset(
                storage_key="a" * 32 + ".png", content_type="image/png", media_type="image", size_bytes=10,
                created_by=users[1].id, avatar_user_id=users[1].id,
            )
            db.add(avatar)
            db.commit()
            self.coach, self.player, self.fan, self.legacy, self.inactive, self.other = [user.id for user in users]
            self.avatar_id = avatar.id

        def override_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def headers(self, user_id):
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    def send(self, sender=None, recipient=None):
        return self.client.post("/friends/requests", json={"user_id": recipient or self.player}, headers=self.headers(sender or self.coach))

    def assert_public(self, payload):
        private = {"name", "email", "password_hash", "birth_date", "strengths", "weaknesses", "height_cm", "weight_kg", "invitation_code", "storage_key"}
        if isinstance(payload, dict):
            self.assertFalse(private.intersection(payload), payload)
            for value in payload.values():
                self.assert_public(value)
        elif isinstance(payload, list):
            for value in payload:
                self.assert_public(value)


class SocialTests(IsolatedSocialCase):
    def test_registration_with_optional_username_preserves_login_and_player_profile(self):
        for alias in (None, " New_Player "):
            with self.subTest(username=alias):
                email = "registered-social" + ("-alias" if alias else "-legacy") + "@example.com"
                payload = {"name": "Real Registered Name", "email": email, "password": "secure-password", "role": "player"}
                if alias is not None:
                    payload["username"] = alias
                registered = self.client.post("/users/register", json=payload)
                self.assertEqual(registered.status_code, 201, registered.text)
                self.assertEqual(registered.json()["username"], "new_player" if alias else None)
                with Session(self.engine) as db:
                    self.assertIsNotNone(db.get(PlayerProfile, registered.json()["id"]))
                login = self.client.post("/users/login", json={"email": email, "password": "secure-password"})
                self.assertEqual(login.status_code, 200, login.text)
                me = self.client.get("/users/me", headers={"Authorization": "Bearer " + login.json()["access_token"]})
                self.assertEqual(me.json()["name"], "Real Registered Name")
                self.assertEqual(me.json()["username"], registered.json()["username"])

    def test_duplicate_username_registration_is_case_insensitive(self):
        response = self.client.post("/users/register", json={
            "name": "Another name", "email": "duplicate-social@example.com", "password": "secure-password",
            "role": "fan", "username": "COACH_ONE",
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["detail"], "Username is already taken")

    def test_each_role_can_set_and_change_only_its_own_username(self):
        for user_id in (self.coach, self.player, self.fan, self.legacy):
            response = self.client.patch("/users/me/username", json={"username": f" USER_{user_id} "}, headers=self.headers(user_id))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["id"], user_id)
            self.assertEqual(response.json()["username"], f"user_{user_id}")
        duplicate = self.client.patch("/users/me/username", json={"username": f"USER_{self.coach}"}, headers=self.headers(self.player))
        self.assertEqual(duplicate.status_code, 409)
        spoof = self.client.patch("/users/me/username", json={"username": "other_alias", "user_id": self.player}, headers=self.headers(self.coach))
        self.assertEqual(spoof.status_code, 422)

    def test_invalid_usernames_are_rejected_without_changes(self):
        for alias in (None, "", "  ", "ab", "a" * 25, "bad-name", "bad.name", "bad name", "álias", "@alias"):
            with self.subTest(alias=alias):
                response = self.client.patch("/users/me/username", json={"username": alias}, headers=self.headers(self.coach))
                self.assertEqual(response.status_code, 422, response.text)
        with Session(self.engine) as db:
            self.assertEqual(db.get(User, self.coach).username, "coach_one")
        same = self.client.patch("/users/me/username", json={"username": "COACH_ONE"}, headers=self.headers(self.coach))
        self.assertEqual(same.status_code, 200)

    def test_database_enforces_normalization_and_uniqueness(self):
        for alias in ("coach_one", "COACH_ONE", "ab"):
            with Session(self.engine) as db:
                db.get(User, self.other).username = alias
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()

    def test_search_is_paginated_case_insensitive_and_escapes_underscores(self):
        response = self.client.get("/users/search?username=COACH_&limit=1&offset=0", headers=self.headers(self.player))
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["items"][0]["username"], "coach_one")
        self.assertEqual((data["limit"], data["offset"]), (1, 0))
        page_two = self.client.get("/users/search?username=coach_&limit=1&offset=1", headers=self.headers(self.player)).json()
        self.assertEqual(page_two["items"][0]["username"], "coach_two")
        self.assert_public(data)
        for query in ("username=%25", "username=abc&limit=101", "username=abc&offset=-1", "username=%20"):
            self.assertEqual(self.client.get("/users/search?" + query, headers=self.headers(self.player)).status_code, 422)

    def test_public_profile_has_no_private_details_and_reuses_avatar(self):
        response = self.client.get(f"/users/{self.player}/public", headers=self.headers(self.coach))
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["username"], "player_one")
        self.assertEqual(data["avatar_media_id"], self.avatar_id)
        self.assertEqual(data["friendship_status"], "NONE")
        self.assertIsNone(data["team"])
        self.assertIsNone(data["position"])
        self.assertIsNone(data["jersey_number"])
        self.assert_public(data)
        legacy = self.client.get(f"/users/{self.legacy}/public", headers=self.headers(self.coach))
        self.assertIsNone(legacy.json()["username"])
        self.assert_public(legacy.json())
        for user_id in (self.inactive, 999999):
            self.assertEqual(self.client.get(f"/users/{user_id}/public", headers=self.headers(self.coach)).status_code, 404)

    def test_send_accept_list_and_remove_friendship_preserving_history(self):
        sent = self.send()
        self.assertEqual(sent.status_code, 201, sent.text)
        request_id = sent.json()["id"]
        self.assertEqual(sent.json()["status"], "PENDING")
        self.assert_public(sent.json())
        received = self.client.get("/friends/requests", headers=self.headers(self.player)).json()
        self.assertEqual(received["received"][0]["id"], request_id)
        self.assertEqual(received["sent"], [])
        self.assert_public(received)
        for actor, state in ((self.coach, "PENDING_SENT"), (self.player, "PENDING_RECEIVED")):
            target = self.player if actor == self.coach else self.coach
            profile = self.client.get(f"/users/{target}/public", headers=self.headers(actor)).json()
            self.assertEqual(profile["friendship_status"], state)
            self.assertEqual(profile["friend_request_id"], request_id)
        accepted = self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(self.player))
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["status"], "ACCEPTED")
        self.assertIsNotNone(accepted.json()["responded_at"])
        for actor, target in ((self.coach, self.player), (self.player, self.coach)):
            friends = self.client.get("/friends", headers=self.headers(actor)).json()
            self.assertEqual([friend["id"] for friend in friends], [target])
            self.assert_public(friends)
            self.assertEqual(self.client.get(f"/users/{target}/public", headers=self.headers(actor)).json()["friendship_status"], "FRIENDS")
        self.assertEqual(self.send().status_code, 409)
        self.assertEqual(self.send(self.player, self.coach).status_code, 409)
        removed = self.client.delete(f"/friends/{self.coach}", headers=self.headers(self.player))
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertEqual(self.client.get("/friends", headers=self.headers(self.coach)).json(), [])
        with Session(self.engine) as db:
            self.assertIsNotNone(db.get(User, self.player))
            self.assertIsNotNone(db.get(PlayerProfile, self.player))
            self.assertEqual(db.get(FriendRequest, request_id).status, FriendRequestStatus.ACCEPTED)
        self.assertEqual(self.send().status_code, 201)

    def test_requests_cannot_be_duplicated_or_sent_to_self_or_inactive_users(self):
        for target, status in ((self.coach, 409), (self.inactive, 404), (999999, 404)):
            self.assertEqual(self.send(recipient=target).status_code, status)
        self.assertEqual(self.send().status_code, 201)
        self.assertEqual(self.send().status_code, 409)
        crossed = self.send(self.player, self.coach)
        self.assertEqual(crossed.status_code, 409)
        self.assertIn("accept or reject", crossed.json()["detail"])
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(FriendRequest)), 1)
        spoof = self.client.post("/friends/requests", headers=self.headers(self.coach), json={"user_id": self.player, "sender_id": self.fan})
        self.assertEqual(spoof.status_code, 422)

    def test_only_recipient_may_accept_or_reject_and_answer_is_final(self):
        request_id = self.send().json()["id"]
        for action in ("accept", "reject"):
            for actor in (self.coach, self.fan):
                self.assertEqual(self.client.post(f"/friends/requests/{request_id}/{action}", headers=self.headers(actor)).status_code, 403)
        rejected = self.client.post(f"/friends/requests/{request_id}/reject", headers=self.headers(self.player))
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["status"], "REJECTED")
        for action in ("accept", "reject"):
            self.assertEqual(self.client.post(f"/friends/requests/{request_id}/{action}", headers=self.headers(self.player)).status_code, 409)
        retry = self.send()
        self.assertEqual(retry.status_code, 201)
        self.assertNotEqual(retry.json()["id"], request_id)

    def test_friendship_works_for_legacy_users_and_all_roles(self):
        for target in (self.player, self.fan, self.legacy):
            request_id = self.send(recipient=target).json()["id"]
            self.assertEqual(self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(target)).status_code, 200)
        friends = self.client.get("/friends", headers=self.headers(self.coach)).json()
        self.assertEqual(len(friends), 3)
        self.assertIsNone(next(friend for friend in friends if friend["id"] == self.legacy)["username"])
        self.assert_public(friends)

    def test_failed_accept_rolls_back_request_and_friendship_together(self):
        request_id = self.send().json()["id"]
        with patch.object(Session, "commit", side_effect=RuntimeError("Forced transaction failure")):
            with self.assertRaises(RuntimeError):
                self.client.post(f"/friends/requests/{request_id}/accept", headers=self.headers(self.player))
        with Session(self.engine) as db:
            self.assertEqual(db.get(FriendRequest, request_id).status, FriendRequestStatus.PENDING)
            self.assertIsNone(db.get(FriendRequest, request_id).responded_at)
            self.assertEqual(db.scalar(select(func.count()).select_from(Friendship)), 0)

    def test_all_social_endpoints_require_authentication(self):
        endpoints = [
            ("GET", "/users/search?username=coach"), ("GET", f"/users/{self.player}/public"),
            ("GET", "/friends"), ("GET", "/friends/requests"),
            ("POST", "/friends/requests"), ("POST", "/friends/requests/1/accept"),
            ("POST", "/friends/requests/1/reject"), ("DELETE", f"/friends/{self.player}"),
            ("PATCH", "/users/me/username"),
        ]
        for method, path in endpoints:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.client.request(method, path).status_code, 401)
        self.assertEqual(self.client.get("/friends", headers=self.headers(self.inactive)).status_code, 401)
        self.assertEqual(self.client.post("/friends/requests/999999/accept", headers=self.headers(self.coach)).status_code, 404)
        self.assertEqual(self.client.delete(f"/friends/{self.player}", headers=self.headers(self.coach)).status_code, 404)


if __name__ == "__main__":
    unittest.main()
