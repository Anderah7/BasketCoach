import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-for-isolated-tests")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

from database import get_db
from main import app
from models import Base, Exercise, ExerciseCategory, Team, Training, TrainingExercise, User, UserRole
from security import create_access_token


def new_exercise(name="Tiro en movimiento"):
    return {
        "name": name,
        "description": "Recibir en carrera y lanzar tras dos pasos.",
        "category": "Shooting",
        "difficulty": "Media",
        "equipment": "Balones",
        "objective": "Mejorar el tiro",
    }


class AIAcceptTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            coach = User(name="Entrenador", email="coach-accept@example.test", password_hash="x", role=UserRole.COACH)
            other = User(name="Otro", email="other-accept@example.test", password_hash="x", role=UserRole.COACH)
            player = User(name="Jugador", email="player-accept@example.test", password_hash="x", role=UserRole.PLAYER)
            db.add_all([coach, other, player])
            db.flush()
            team = Team(name="Equipo aceptar IA", coach_id=coach.id, is_managed=True)
            other_team = Team(name="Equipo ajeno IA", coach_id=other.id, is_managed=True)
            db.add_all([team, other_team])
            db.flush()
            public = Exercise(name="Pases", description="Pases en parejas", category=ExerciseCategory.PASSING,
                              created_by=other.id, is_public=True)
            own = Exercise(name="Defensa propia", description="Desplazamientos laterales", category=ExerciseCategory.DEFENSE,
                           created_by=coach.id, is_public=False)
            hidden = Exercise(name="Privado ajeno", description="Bloqueos", category=ExerciseCategory.TACTICS,
                              created_by=other.id, is_public=False)
            db.add_all([public, own, hidden])
            db.commit()
            self.coach_id, self.other_id, self.player_id = coach.id, other.id, player.id
            self.team_id, self.other_team_id = team.id, other_team.id
            self.public_id, self.own_id, self.hidden_id = public.id, own.id, hidden.id

        def override_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def headers(self, user_id=None):
        return {"Authorization": f"Bearer {create_access_token(user_id or self.coach_id)}"}

    def training_payload(self, exercises=None):
        return {
            "team_id": self.team_id,
            "title": "Sesión modificada por entrenador",
            "description": "Técnica de pase y tiro",
            "date": "2030-05-10T17:00:00+02:00",
            "duration": 45,
            "exercises": exercises or [
                {"existing_exercise_id": self.public_id, "duration": 15, "sets": 3, "repetitions": 10},
                {"new_exercise": new_exercise(), "duration": 20, "sets": 4, "repetitions": 8},
                {"existing_exercise_id": self.own_id, "duration": 10, "sets": 2, "repetitions": 6},
            ],
        }

    def count(self, model):
        with Session(self.engine) as db:
            return db.scalar(select(func.count()).select_from(model))

    def test_accept_edited_exercises_and_use_in_manual_training(self):
        response = self.client.post(
            "/ai/exercises/accept",
            json={"exercises": [new_exercise("Tiro editado"), new_exercise("Pase editado")]},
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual([item["name"] for item in created], ["Tiro editado", "Pase editado"])
        self.assertEqual(len({item["id"] for item in created}), 2)
        self.assertTrue(all(item["created_by"] == self.coach_id and item["is_public"] is False for item in created))
        with Session(self.engine) as db:
            self.assertEqual(db.get(Exercise, created[0]["id"]).category, ExerciseCategory.SHOOTING)

        manual = self.client.post(
            "/trainings",
            json={"team_id": self.team_id, "title": "Manual asistido", "date": "2030-05-10T17:00:00+02:00",
                  "duration": 20, "exercises": [{"exercise_id": created[0]["id"], "duration": 20, "sets": 3, "repetitions": 8}]},
            headers=self.headers(),
        )
        self.assertEqual(manual.status_code, 201, manual.text)
        self.assertEqual(manual.json()["creation_mode"], "MANUAL")

    def test_accept_training_mixes_existing_and_new_in_order(self):
        payload = self.training_payload()
        payload["exercises"][0].update({"source": "EXISTING", "rationale": "Aprovechar el catalogo"})
        payload["exercises"][1].update({"source": "NEW", "rationale": "Adaptado al equipo"})
        response = self.client.post("/ai/trainings/accept", json=payload, headers=self.headers())
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["creation_mode"], "AI")
        self.assertEqual(body["title"], "Sesión modificada por entrenador")
        self.assertEqual([link["exercise_order"] for link in body["exercises"]], [1, 2, 3])
        self.assertEqual([link["duration"] for link in body["exercises"]], [15, 20, 10])
        self.assertEqual(body["exercises"][0]["exercise"]["id"], self.public_id)
        self.assertEqual(body["exercises"][2]["exercise"]["id"], self.own_id)
        new = body["exercises"][1]["exercise"]
        self.assertTrue(new["id"] > self.hidden_id)
        self.assertEqual(new["created_by"], self.coach_id)
        self.assertFalse(new["is_public"])
        self.assertEqual(self.count(Training), 1)
        self.assertEqual(self.count(TrainingExercise), 3)
        self.assertEqual(self.count(Exercise), 4)

    def test_auth_ownership_and_private_exercises(self):
        self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [new_exercise()]}).status_code, 401)
        self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [new_exercise()]},
                                          headers=self.headers(self.player_id)).status_code, 403)
        self.assertEqual(self.client.post("/ai/trainings/accept", json=self.training_payload(),
                                          headers=self.headers(self.other_id)).status_code, 403)
        foreign = self.training_payload()
        foreign["team_id"] = self.other_team_id
        self.assertEqual(self.client.post("/ai/trainings/accept", json=foreign, headers=self.headers()).status_code, 403)
        hidden = self.training_payload([{"existing_exercise_id": self.hidden_id, "duration": 10, "sets": 2, "repetitions": 8}])
        self.assertEqual(self.client.post("/ai/trainings/accept", json=hidden, headers=self.headers()).status_code, 403)
        missing = self.training_payload([{"existing_exercise_id": 999999, "duration": 10, "sets": 2, "repetitions": 8}])
        self.assertEqual(self.client.post("/ai/trainings/accept", json=missing, headers=self.headers()).status_code, 404)
        self.assertEqual(self.count(Training), 0)
        self.assertEqual(self.count(Exercise), 3)

    def test_rejects_invalid_and_protected_fields(self):
        bad = new_exercise()
        bad["category"] = "Unknown"
        self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [bad]},
                                          headers=self.headers()).status_code, 422)
        for field, value in [("name", "  "), ("description", " "), ("difficulty", "x" * 31)]:
            bad = new_exercise()
            bad[field] = value
            self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [bad]},
                                              headers=self.headers()).status_code, 422)
        bad = new_exercise()
        bad["is_public"] = True
        self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [bad]},
                                          headers=self.headers()).status_code, 422)
        bad = new_exercise()
        bad["created_by"] = self.other_id
        self.assertEqual(self.client.post("/ai/exercises/accept", json={"exercises": [bad]},
                                          headers=self.headers()).status_code, 422)
        both = self.training_payload([{"existing_exercise_id": self.public_id, "new_exercise": new_exercise(),
                                      "duration": 10, "sets": 2, "repetitions": 8}])
        self.assertEqual(self.client.post("/ai/trainings/accept", json=both, headers=self.headers()).status_code, 422)
        mismatched = self.training_payload([{"source": "NEW", "existing_exercise_id": self.public_id,
                                            "duration": 10, "sets": 2, "repetitions": 8}])
        self.assertEqual(self.client.post("/ai/trainings/accept", json=mismatched, headers=self.headers()).status_code, 422)
        empty = self.training_payload()
        empty["exercises"] = []
        self.assertEqual(self.client.post("/ai/trainings/accept", json=empty, headers=self.headers()).status_code, 422)
        wrong_date = self.training_payload()
        wrong_date["date"] = "2030-05-10T17:00:00"
        self.assertEqual(self.client.post("/ai/trainings/accept", json=wrong_date, headers=self.headers()).status_code, 422)
        self.assertEqual(self.count(Training), 0)
        self.assertEqual(self.count(Exercise), 3)

    def test_rolls_back_when_response_fails_after_flush(self):
        with patch("routers.ai.ExerciseResponse.model_validate", side_effect=RuntimeError("simulated")):
            response = self.client.post("/ai/exercises/accept", json={"exercises": [new_exercise()]}, headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.count(Exercise), 3)

        with patch("routers.ai._training_detail", side_effect=RuntimeError("simulated")):
            response = self.client.post("/ai/trainings/accept", json=self.training_payload(), headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.count(Training), 0)
        self.assertEqual(self.count(TrainingExercise), 0)
        self.assertEqual(self.count(Exercise), 3)


if __name__ == "__main__":
    unittest.main()
