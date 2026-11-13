import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from llm import get_provider
from main import app


class FakeProvider:
    def generate(self, request):
        return {
            "exercises": [{
                "source": "NEW", "existing_exercise_id": None,
                "new_exercise": {
                    "name": "Tiro tras bote",
                    "description": "Botar desde el ala, frenar y lanzar desde media distancia.",
                    "category": "Shooting", "difficulty": "Media", "equipment": "Balones",
                    "objective": "Mejorar el tiro",
                },
                "duration": 20, "sets": 3, "repetitions": 8, "rationale": "Practicar tiro",
            }],
        }


class InternalAuthTests(unittest.TestCase):
    def setUp(self):
        self.config_patch = patch("internal_auth.dotenv_values", return_value={"AI_INTERNAL_SECRET": "test-internal-secret"})
        self.config_patch.start()
        app.dependency_overrides[get_provider] = lambda: FakeProvider()
        self.client = TestClient(app)
        self.payload = {"prompt": "Mejorar tiro", "generation_type": "EXERCISES", "exercise_mode": "NEW"}

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.config_patch.stop()

    def test_generate_requires_shared_secret(self):
        self.assertEqual(self.client.post("/generate", json=self.payload).status_code, 403)
        self.assertEqual(self.client.post("/generate", json=self.payload, headers={"X-Internal-Secret": "incorrecto"}).status_code, 403)
        response = self.client.post("/generate", json=self.payload, headers={"X-Internal-Secret": "test-internal-secret"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["exercises"][0]["source"], "NEW")


if __name__ == "__main__":
    unittest.main()
