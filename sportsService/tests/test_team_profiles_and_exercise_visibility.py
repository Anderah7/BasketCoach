import os
import unittest
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-for-isolated-tests")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

from database import get_db
from main import app
from models import Base, Exercise, PlayerPosition, PlayerProfile, Team, User, UserRole
from security import create_access_token


class TeamProfileAndVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            coach = User(name="Coach", email="coach@example.com", password_hash="x", role=UserRole.COACH)
            other = User(name="Other coach", email="other@example.com", password_hash="x", role=UserRole.COACH)
            player = User(name="Player", email="player@example.com", password_hash="x", role=UserRole.PLAYER)
            outsider = User(name="Other player", email="outsider@example.com", password_hash="x", role=UserRole.PLAYER)
            fan = User(name="Fan", email="fan@example.com", password_hash="x", role=UserRole.FAN)
            db.add_all([coach, other, player, outsider, fan])
            db.flush()
            team = Team(name="Home team", coach_id=coach.id, is_managed=True)
            other_team = Team(name="Other team", coach_id=other.id, is_managed=True)
            db.add_all([team, other_team])
            db.flush()
            db.add_all([
                PlayerProfile(
                    user_id=player.id, team_id=team.id, jersey_number=7,
                    position=PlayerPosition.POINT_GUARD, height_cm=185, weight_kg=78.5,
                    birth_date=date(2000, 5, 20), strengths="Passing", weaknesses="Defence",
                ),
                PlayerProfile(user_id=outsider.id, team_id=other_team.id),
            ])
            exercise = Exercise(name="Shooting drill", description="Practice shooting", created_by=coach.id, is_public=False)
            catalogue = Exercise(name="Shared drill", description="Shared catalogue drill", is_public=True, created_by=None)
            db.add_all([exercise, catalogue])
            db.commit()
            self.coach_id, self.other_id, self.player_id, self.outsider_id, self.fan_id = coach.id, other.id, player.id, outsider.id, fan.id
            self.team_id, self.other_team_id = team.id, other_team.id
            self.exercise_id, self.catalogue_id = exercise.id, catalogue.id

        def override_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def headers(self, user_id):
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    def test_coach_views_complete_profile_and_edits_evaluation(self):
        path = f"/teams/{self.team_id}/players/{self.player_id}"
        response = self.client.get(path, headers=self.headers(self.coach_id))
        self.assertEqual(response.status_code, 200, response.text)
        profile = response.json()
        self.assertEqual(profile["birth_date"], "2000-05-20")
        self.assertEqual(profile["email"], "player@example.com")
        self.assertEqual(profile["height_cm"], 185)
        self.assertEqual(profile["position"], "Point Guard")
        self.assertEqual(profile["team_id"], self.team_id)
        self.assertIn("created_at", profile)
        self.assertNotIn("password_hash", profile)
        edited = self.client.patch(path, headers=self.headers(self.coach_id), json={
            "jersey_number": 12, "strengths": "Passing and shooting", "weaknesses": "Rebounding",
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        detail = self.client.get(path, headers=self.headers(self.coach_id)).json()
        self.assertEqual(detail["jersey_number"], 12)
        self.assertEqual(detail["strengths"], "Passing and shooting")
        self.assertEqual(detail["birth_date"], "2000-05-20")

    def test_profile_permissions_and_team_membership(self):
        own_path = f"/teams/{self.team_id}/players/{self.player_id}"
        self.assertEqual(self.client.get(own_path).status_code, 401)
        for user_id in [self.other_id, self.player_id, self.fan_id]:
            self.assertEqual(self.client.get(own_path, headers=self.headers(user_id)).status_code, 403)
        self.assertEqual(self.client.get(
            f"/teams/{self.team_id}/players/{self.outsider_id}", headers=self.headers(self.coach_id),
        ).status_code, 404)
        self.assertEqual(self.client.get(
            f"/teams/{self.other_team_id}/players/{self.outsider_id}", headers=self.headers(self.coach_id),
        ).status_code, 403)
        self.assertEqual(self.client.get(
            f"/teams/99999/players/{self.player_id}", headers=self.headers(self.coach_id),
        ).status_code, 404)

    def test_removal_keeps_user_and_sporting_profile(self):
        path = f"/teams/{self.team_id}/players/{self.player_id}"
        removed = self.client.delete(path, headers=self.headers(self.coach_id))
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertEqual(self.client.get(path, headers=self.headers(self.coach_id)).status_code, 404)
        with Session(self.engine) as db:
            self.assertIsNotNone(db.get(User, self.player_id))
            profile = db.get(PlayerProfile, self.player_id)
            self.assertIsNotNone(profile)
            self.assertIsNone(profile.team_id)
            self.assertIsNone(profile.jersey_number)
            self.assertIsNone(profile.strengths)
            self.assertEqual(profile.birth_date, date(2000, 5, 20))

    def test_publication_changes_catalogue_visibility(self):
        path = f"/exercises/{self.exercise_id}/visibility"
        def catalogue_ids():
            return [item["id"] for item in self.client.get("/exercises", headers=self.headers(self.other_id)).json()]

        self.assertNotIn(self.exercise_id, catalogue_ids())
        published = self.client.patch(path, headers=self.headers(self.coach_id), json={"is_public": True})
        self.assertEqual(published.status_code, 200, published.text)
        self.assertTrue(published.json()["is_public"])
        self.assertEqual(published.json()["created_by"], self.coach_id)
        self.assertIn(self.exercise_id, catalogue_ids())
        private = self.client.patch(path, headers=self.headers(self.coach_id), json={"is_public": False})
        self.assertEqual(private.status_code, 200, private.text)
        self.assertFalse(private.json()["is_public"])
        self.assertNotIn(self.exercise_id, catalogue_ids())

    def test_visibility_requires_owner_coach(self):
        path = f"/exercises/{self.exercise_id}/visibility"
        self.assertEqual(self.client.patch(path, json={"is_public": True}).status_code, 401)
        for user_id in [self.other_id, self.player_id, self.fan_id]:
            self.assertEqual(self.client.patch(path, headers=self.headers(user_id), json={"is_public": True}).status_code, 403)
        self.client.patch(path, headers=self.headers(self.coach_id), json={"is_public": True})
        self.assertEqual(self.client.patch(path, headers=self.headers(self.other_id), json={"is_public": False}).status_code, 403)
        self.assertEqual(self.client.patch(
            f"/exercises/{self.catalogue_id}/visibility", headers=self.headers(self.coach_id), json={"is_public": False},
        ).status_code, 403)
        self.assertEqual(self.client.patch(
            "/exercises/99999/visibility", headers=self.headers(self.coach_id), json={"is_public": True},
        ).status_code, 404)

    def test_visibility_validates_boolean_and_forbids_protected_fields(self):
        path = f"/exercises/{self.exercise_id}/visibility"
        for body in [{}, {"is_public": "true"}, {"is_public": True, "created_by": self.other_id}]:
            self.assertEqual(self.client.patch(path, headers=self.headers(self.coach_id), json=body).status_code, 422)
        with Session(self.engine) as db:
            self.assertFalse(db.get(Exercise, self.exercise_id).is_public)


if __name__ == "__main__":
    unittest.main()
