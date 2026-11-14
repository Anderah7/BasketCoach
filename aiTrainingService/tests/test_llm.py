import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from google.genai import errors

from llm import (
    GeminiProposalProvider, LLMConfigurationError, LLMInvalidResponseError,
    LLMQuotaError, LLMRequestError, _gemini_json_schema,
)
from schemas import ExercisesProposal, GenerateRequest, TrainingProposal


class GeminiProviderTests(unittest.TestCase):
    def setUp(self):
        self.config_patch = patch("llm.dotenv_values", return_value={
            "GEMINI_API_KEY": "test-private-api-key", "GEMINI_MODEL": "test-model",
        })
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.client = Mock()
        self.provider = GeminiProposalProvider(client=self.client)
        self.request = GenerateRequest(prompt="Create a shooting drill", generation_type="EXERCISES", exercise_mode="NEW")
        self.exercise = {
            "source": "NEW", "existing_exercise_id": None,
            "new_exercise": {
                "name": "Catch and shoot", "description": "Catch a pass on the wing and shoot with balanced footwork.",
                "category": "Shooting", "difficulty": "Intermediate", "equipment": "Basketball",
                "objective": "Improve shooting technique",
            },
            "duration": 20, "sets": 3, "repetitions": 8, "rationale": "Practice balanced shooting",
        }

    def respond(self, payload, *, as_text=False):
        self.client.models.generate_content.return_value = SimpleNamespace(
            parsed=None if as_text else payload, text=json.dumps(payload) if as_text else None,
            candidates=[], prompt_feedback=None,
        )

    def test_schema_moves_bounds_to_guidance_and_keeps_types_and_enums(self):
        bounds = {"minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"}
        def assert_no_bounds(value):
            if isinstance(value, dict):
                self.assertFalse(bounds.intersection(value))
                for child in value.values():
                    assert_no_bounds(child)
            elif isinstance(value, list):
                for child in value:
                    assert_no_bounds(child)

        for model in (ExercisesProposal, TrainingProposal):
            original = model.model_json_schema()
            schema = _gemini_json_schema(model)
            assert_no_bounds(schema)
            self.assertEqual(schema["type"], "object")
            self.assertEqual(schema["required"], original["required"])
            self.assertIn("Maximum number of items", schema["properties"]["exercises"]["description"])
            self.assertEqual(schema["$defs"]["ExerciseCategory"]["enum"], original["$defs"]["ExerciseCategory"]["enum"])
            self.assertIn("Maximum value: 30", schema["$defs"]["ProposedExercise"]["properties"]["sets"]["description"])
            self.assertEqual(model.model_json_schema(), original)

    def test_generates_exercises_using_structured_json_schema(self):
        self.respond({"exercises": [self.exercise]})
        proposal = self.provider.generate(self.request)
        self.assertIsInstance(proposal, ExercisesProposal)
        self.assertEqual(proposal.exercises[0].new_exercise.category.value, "Shooting")
        sent = self.client.models.generate_content.call_args.kwargs
        self.assertEqual(sent["config"].response_mime_type, "application/json")
        self.assertEqual(sent["config"].response_json_schema, _gemini_json_schema(ExercisesProposal))
        self.assertEqual(json.loads(sent["contents"])["prompt"], self.request.prompt)
        self.client.models.generate_content.assert_called_once()

    def test_generates_training_from_json_text(self):
        request = GenerateRequest(prompt="Work on shooting", generation_type="TRAINING", duration=20, exercise_mode="NEW")
        self.respond({"title": "Shooting session", "description": "Practice shooting", "duration": 20, "exercises": [self.exercise]}, as_text=True)
        proposal = self.provider.generate(request)
        self.assertIsInstance(proposal, TrainingProposal)
        self.assertEqual(proposal.duration, 20)
        self.assertEqual(self.client.models.generate_content.call_args.kwargs["config"].response_json_schema, _gemini_json_schema(TrainingProposal))

    def test_full_pydantic_validation_rejects_invalid_values(self):
        zero_sets = copy.deepcopy(self.exercise)
        zero_sets["sets"] = 0
        negative_duration = copy.deepcopy(self.exercise)
        negative_duration["duration"] = -1
        invalid_category = copy.deepcopy(self.exercise)
        invalid_category["new_exercise"]["category"] = "Unsupported"
        invalid_source = copy.deepcopy(self.exercise)
        invalid_source["existing_exercise_id"] = 123
        for exercises in ([], [self.exercise] * 13, [zero_sets], [negative_duration], [invalid_category], [invalid_source]):
            with self.subTest(exercises=len(exercises)):
                self.respond({"exercises": exercises})
                with self.assertRaises(LLMInvalidResponseError):
                    self.provider.generate(self.request)

    def test_400_logs_reason_without_exposing_key_or_retrying(self):
        self.client.models.generate_content.side_effect = errors.ClientError(400, {"error": {
            "code": 400, "status": "INVALID_ARGUMENT",
            "message": "The specified schema produces a constraint that has too many states for serving. test-private-api-key",
        }})
        with self.assertLogs("llm", level="WARNING") as logs:
            with self.assertRaises(LLMRequestError) as caught:
                self.provider.generate(self.request)
        self.assertIn("too many states", " ".join(logs.output))
        self.assertNotIn("test-private-api-key", " ".join(logs.output))
        self.assertNotIn("test-private-api-key", str(caught.exception))
        self.client.models.generate_content.assert_called_once()

    def test_invalid_api_key_returned_as_400_is_configuration_error(self):
        self.client.models.generate_content.side_effect = errors.ClientError(400, {"error": {
            "code": 400, "status": "INVALID_ARGUMENT", "message": "API key not valid. Please pass a valid API key.",
            "details": [{"reason": "API_KEY_INVALID"}],
        }})
        with self.assertRaises(LLMConfigurationError):
            self.provider.generate(self.request)

    def test_project_precondition_returned_as_400_is_configuration_error(self):
        self.client.models.generate_content.side_effect = errors.ClientError(400, {"error": {
            "code": 400, "status": "FAILED_PRECONDITION", "message": "Free tier is unavailable for this project.",
        }})
        with self.assertLogs("llm", level="WARNING"):
            with self.assertRaises(LLMConfigurationError):
                self.provider.generate(self.request)

    def test_quota_errors_keep_their_existing_mapping(self):
        self.client.models.generate_content.side_effect = errors.ClientError(429, {"error": {
            "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded",
        }})
        with self.assertRaises(LLMQuotaError):
            self.provider.generate(self.request)


if __name__ == "__main__":
    unittest.main()
