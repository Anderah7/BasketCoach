import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-for-isolated-tests")
os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASSWORD", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "test")

from ai_client import get_ai_http_client
from database import get_db
from main import app
from models import Base, Exercise, ExerciseCategory, PlayerPosition, PlayerProfile, Team, User, UserRole
from security import create_access_token


AI_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "aiTrainingService" / "schemas.py"
spec = importlib.util.spec_from_file_location("ai_contract_schemas", AI_SCHEMA_PATH)
ai_contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai_contract)


def new_exercise():
    return {
        "source": "NEW", "existing_exercise_id": None,
        "new_exercise": {
            "name": "Tiro tras bote",
            "description": "Botar desde el ala, frenar y lanzar desde media distancia.",
            "category": "Shooting", "difficulty": "Media", "equipment": "Balones",
            "objective": "Mejorar el tiro tras bote",
        },
        "duration": 20, "sets": 3, "repetitions": 8, "rationale": "Trabaja la debilidad indicada",
    }


class AIGenerateIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        with Session(cls.engine) as db:
            coach = User(name="Entrenador", email="coach@example.test", password_hash="x", role=UserRole.COACH)
            other_coach = User(name="Otro", email="other@example.test", password_hash="x", role=UserRole.COACH)
            player = User(name="Jugador", email="player@example.test", password_hash="x", role=UserRole.PLAYER)
            outsider = User(name="Fuera", email="outsider@example.test", password_hash="x", role=UserRole.PLAYER)
            db.add_all([coach, other_coach, player, outsider])
            db.flush()
            team = Team(name="Equipo IA", coach_id=coach.id, is_managed=True)
            other_team = Team(name="Otro equipo IA", coach_id=other_coach.id, is_managed=True)
            db.add_all([team, other_team])
            db.flush()
            db.add_all([
                PlayerProfile(user_id=player.id, team_id=team.id, position=PlayerPosition.POINT_GUARD,
                              strengths="Pase", weaknesses="Tiro exterior"),
                PlayerProfile(user_id=outsider.id, team_id=other_team.id, position=PlayerPosition.CENTER),
            ])
            public = Exercise(name="Tiro libre", description="Lanzar desde la línea", category=ExerciseCategory.SHOOTING,
                              is_public=True, created_by=other_coach.id)
            private = Exercise(name="Defensa privada", description="Desplazamientos defensivos", category=ExerciseCategory.DEFENSE,
                               is_public=False, created_by=coach.id)
            hidden = Exercise(name="Privado ajeno", description="Ejercicio secreto", category=ExerciseCategory.TACTICS,
                              is_public=False, created_by=other_coach.id)
            unclassified = Exercise(name="Sin categoría", description="Ejercicio sin clasificar", category=None,
                                    is_public=True, created_by=coach.id)
            db.add_all([public, private, hidden, unclassified])
            db.commit()
            cls.coach_id, cls.other_coach_id = coach.id, other_coach.id
            cls.player_id, cls.outsider_id = player.id, outsider.id
            cls.team_id, cls.other_team_id = team.id, other_team.id
            cls.public_id, cls.private_id, cls.hidden_id = public.id, private.id, hidden.id

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        self.requests = []
        self.upstream = {"generation_type": "EXERCISES", "exercises": [new_exercise()], "training": None}
        self.config_patch = patch("ai_client.dotenv_values", return_value={
            "AI_TRAINING_SERVICE_URL": "http://ai-service.test",
            "AI_INTERNAL_SECRET": "test-internal-secret",
        })
        self.config_patch.start()

        def override_db():
            with Session(self.engine) as db:
                yield db

        def handle(request):
            self.requests.append(request)
            if isinstance(self.upstream, Exception):
                raise self.upstream
            if isinstance(self.upstream, httpx.Response):
                return self.upstream
            return httpx.Response(200, json=self.upstream)

        def override_ai_client():
            with httpx.Client(transport=httpx.MockTransport(handle)) as client:
                yield client

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_ai_http_client] = override_ai_client
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.config_patch.stop()

    def post(self, user_id=None, **changes):
        payload = {"team_id": self.team_id, "prompt": "Mejorar el tiro", "generation_type": "EXERCISES", "exercise_mode": "MIXED"}
        payload.update(changes)
        headers = {"Authorization": f"Bearer {create_access_token(user_id or self.coach_id)}"}
        return self.client.post("/ai/generate", json=payload, headers=headers)

    def test_contract_and_private_context_without_personal_data(self):
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        sent = json.loads(self.requests[0].content)
        ai_contract.GenerateRequest.model_validate(sent)
        self.assertEqual(sent["players"], [{"position": "Point Guard", "strengths": "Pase", "weaknesses": "Tiro exterior"}])
        self.assertEqual({exercise["id"] for exercise in sent["available_exercises"]}, {self.public_id, self.private_id})
        self.assertNotIn("email", json.dumps(sent).lower())
        self.assertNotIn("password", json.dumps(sent).lower())
        self.assertNotIn("team_id", sent)
        self.assertNotIn("player_ids", sent)
        self.assertNotIn("authorization", {name.lower() for name in self.requests[0].headers})
        self.assertEqual(self.requests[0].headers.get("X-Internal-Secret"), "test-internal-secret")

    def test_permissions_and_player_membership(self):
        self.assertEqual(self.post(user_id=self.player_id).status_code, 403)
        self.assertEqual(self.post(user_id=self.other_coach_id).status_code, 403)
        self.assertEqual(self.post(player_ids=[self.outsider_id]).status_code, 404)
        self.assertEqual(self.post(player_ids=[self.player_id, self.player_id]).status_code, 422)
        self.assertEqual(self.client.post("/ai/generate", json={"team_id": self.team_id, "prompt": "Tiro", "generation_type": "EXERCISES"}).status_code, 401)
        self.assertEqual(len(self.requests), 0)

    def test_selected_players_and_training_response(self):
        self.upstream = {
            "generation_type": "TRAINING", "exercises": None,
            "training": {"title": "Tiro", "description": "Sesión de tiro", "duration": 25,
                         "exercises": [{**new_exercise(), "duration": 25}]},
        }
        response = self.post(generation_type="TRAINING", duration=25, player_ids=[self.player_id], exercise_mode="NEW")
        self.assertEqual(response.status_code, 200, response.text)
        sent = json.loads(self.requests[0].content)
        ai_contract.GenerateRequest.model_validate(sent)
        self.assertEqual(len(sent["players"]), 1)
        self.assertEqual(sent["available_exercises"], [])
        self.assertEqual(response.json()["training"]["exercises"][0]["new_exercise"]["category"], "Shooting")

    def test_rejects_unlisted_existing_exercise_and_invalid_response(self):
        existing = {**new_exercise(), "source": "EXISTING", "existing_exercise_id": self.hidden_id, "new_exercise": None}
        self.upstream = {"generation_type": "EXERCISES", "exercises": [existing], "training": None}
        self.assertEqual(self.post().status_code, 502)
        self.upstream = {"generation_type": "EXERCISES", "exercises": [{**new_exercise(), "new_exercise": {**new_exercise()["new_exercise"], "category": "Unknown"}}], "training": None}
        self.assertEqual(self.post().status_code, 502)

    def test_http_errors(self):
        self.upstream = httpx.Response(429, json={"detail": "Cuota de Gemini alcanzada"})
        self.assertEqual(self.post().status_code, 429)
        self.upstream = httpx.ReadTimeout("timeout")
        self.assertEqual(self.post().status_code, 504)
        self.upstream = httpx.Response(403, json={"detail": "Acceso interno no autorizado"})
        self.assertEqual(self.post().status_code, 503)

    def test_category_contract_matches_ai_service(self):
        self.assertEqual({item.value for item in ExerciseCategory}, {item.value for item in ai_contract.ExerciseCategory})


if __name__ == "__main__":
    unittest.main()
