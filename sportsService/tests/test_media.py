import base64
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
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
    Base, Exercise, MediaAsset, PlayerProfile, Team, Training,
    TrainingAssignment, TrainingExercise, User, UserRole,
)
from security import create_access_token


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9K4q0AAAAASUVORK5CYII="
)
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2" + b"media-data"


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.env_patch = patch.dict(os.environ, {"MEDIA_ROOT": self.temp.name})
        self.env_patch.start()
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            coach = User(name="Coach", email="coach-media@example.com", password_hash="x", role=UserRole.COACH)
            other = User(name="Other", email="other-media@example.com", password_hash="x", role=UserRole.COACH)
            player = User(name="Player", email="player-media@example.com", password_hash="x", role=UserRole.PLAYER)
            fan = User(name="Fan", email="fan-media@example.com", password_hash="x", role=UserRole.FAN)
            db.add_all([coach, other, player, fan]); db.flush()
            team = Team(name="Media test team", coach_id=coach.id, is_managed=True)
            db.add(team); db.flush()
            profile = PlayerProfile(user_id=player.id, team_id=team.id)
            exercise = Exercise(name="Drill", description="Basketball drill", created_by=coach.id, is_public=False)
            training = Training(team_id=team.id, created_by=coach.id, title="Practice", date=datetime.fromisoformat("2030-01-01T17:00:00+00:00"), duration=30)
            db.add_all([profile, exercise, training]); db.flush()
            db.add_all([
                TrainingExercise(training_id=training.id, exercise_id=exercise.id, exercise_order=1),
                TrainingAssignment(training_id=training.id, player_id=player.id),
            ])
            db.commit()
            self.coach_id, self.other_id, self.player_id, self.fan_id = coach.id, other.id, player.id, fan.id
            self.exercise_id, self.training_id = exercise.id, training.id

        def override_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()
        self.env_patch.stop()
        self.temp.cleanup()

    def headers(self, user_id):
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    def test_avatar_upload_replace_and_delete(self):
        first = self.client.put(
            "/users/me/avatar", files={"file": ("first.png", PNG, "image/png")},
            headers=self.headers(self.player_id),
        )
        self.assertEqual(first.status_code, 200, first.text)
        first_id = first.json()["id"]
        self.assertEqual(self.client.get("/users/me", headers=self.headers(self.player_id)).json()["avatar_media_id"], first_id)
        self.assertEqual(self.client.get(f"/media/{first_id}", headers=self.headers(self.coach_id)).content, PNG)
        second = self.client.put(
            "/users/me/avatar", files={"file": ("second.png", PNG, "image/png")},
            headers=self.headers(self.player_id),
        )
        self.assertEqual(second.status_code, 200, second.text)
        if first_id != second.json()["id"]:
            self.assertEqual(self.client.get(f"/media/{first_id}", headers=self.headers(self.player_id)).status_code, 404)
        self.assertEqual(self.client.get("/users/me", headers=self.headers(self.player_id)).json()["avatar_media_id"], second.json()["id"])
        self.assertEqual(len(list(Path(self.temp.name).iterdir())), 1)
        deleted = self.client.delete("/users/me/avatar", headers=self.headers(self.player_id))
        self.assertEqual(deleted.status_code, 204)
        self.assertIsNone(self.client.get("/users/me", headers=self.headers(self.player_id)).json()["avatar_media_id"])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_exercise_media_permissions_and_assigned_player_access(self):
        forbidden = self.client.post(
            f"/exercises/{self.exercise_id}/media", files=[("files", ("drill.png", PNG, "image/png"))],
            headers=self.headers(self.other_id),
        )
        self.assertEqual(forbidden.status_code, 403)
        uploaded = self.client.post(
            f"/exercises/{self.exercise_id}/media", files=[("files", ("drill.png", PNG, "image/png"))],
            headers=self.headers(self.coach_id),
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        media_id = uploaded.json()[0]["id"]
        self.assertEqual(self.client.get("/exercises", headers=self.headers(self.coach_id)).json()[0]["media_assets"][0]["id"], media_id)
        self.assertEqual(self.client.get(f"/media/{media_id}", headers=self.headers(self.player_id)).content, PNG)
        self.assertEqual(self.client.get(f"/media/{media_id}", headers=self.headers(self.fan_id)).status_code, 403)
        self.assertEqual(self.client.get(f"/media/{media_id}").status_code, 401)

    def test_training_video_visible_to_assigned_player(self):
        uploaded = self.client.post(
            f"/trainings/{self.training_id}/media", files=[("files", ("video.mp4", MP4, "video/mp4"))],
            headers=self.headers(self.coach_id),
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        media_id = uploaded.json()[0]["id"]
        self.assertEqual(uploaded.json()[0]["media_type"], "video")
        detail = self.client.get(f"/players/me/trainings/1", headers=self.headers(self.player_id))
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["media_assets"][0]["id"], media_id)
        self.assertEqual(detail.json()["exercises"][0]["exercise"]["media_assets"], [])
        self.assertEqual(self.client.get(f"/media/{media_id}", headers=self.headers(self.player_id)).content, MP4)
        self.assertEqual(self.client.get(f"/media/{media_id}", headers=self.headers(self.other_id)).status_code, 403)

    def test_invalid_upload_creates_no_row_or_file(self):
        response = self.client.post(
            f"/exercises/{self.exercise_id}/media", files=[("files", ("fake.png", b"not an image", "image/png"))],
            headers=self.headers(self.coach_id),
        )
        self.assertEqual(response.status_code, 422)
        with Session(self.engine) as db:
            self.assertEqual(db.scalars(select(MediaAsset)).all(), [])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_multiple_upload_rolls_back_if_one_file_is_invalid(self):
        response = self.client.post(
            f"/exercises/{self.exercise_id}/media",
            files=[
                ("files", ("valid.png", PNG, "image/png")),
                ("files", ("invalid.png", b"invalid", "image/png")),
            ],
            headers=self.headers(self.coach_id),
        )
        self.assertEqual(response.status_code, 422)
        with Session(self.engine) as db:
            self.assertEqual(db.scalars(select(MediaAsset)).all(), [])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_owner_can_remove_media_but_another_coach_cannot(self):
        uploaded = self.client.post(
            f"/exercises/{self.exercise_id}/media",
            files=[("files", ("drill.png", PNG, "image/png"))],
            headers=self.headers(self.coach_id),
        )
        media_id = uploaded.json()[0]["id"]
        self.assertEqual(self.client.delete(f"/media/{media_id}", headers=self.headers(self.other_id)).status_code, 403)
        self.assertEqual(self.client.delete(f"/media/{media_id}", headers=self.headers(self.coach_id)).status_code, 204)
        self.assertEqual(self.client.get(f"/media/{media_id}", headers=self.headers(self.coach_id)).status_code, 404)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_deleting_unassigned_training_removes_its_media(self):
        uploaded = self.client.post(
            f"/trainings/{self.training_id}/media",
            files=[("files", ("session.png", PNG, "image/png"))],
            headers=self.headers(self.coach_id),
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        with Session(self.engine) as db:
            assignment = db.scalar(select(TrainingAssignment).where(TrainingAssignment.training_id == self.training_id))
            db.delete(assignment)
            db.commit()
        response = self.client.delete(f"/trainings/{self.training_id}", headers=self.headers(self.coach_id))
        self.assertEqual(response.status_code, 204, response.text)
        with Session(self.engine) as db:
            self.assertEqual(db.scalars(select(MediaAsset)).all(), [])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
