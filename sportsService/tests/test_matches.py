"""Match API tests against temporary SQLite files, never the configured PostgreSQL database."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

os.environ.setdefault("JWT_SECRET_KEY", "isolated-match-tests-with-a-long-enough-secret")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from database import get_db
from models import Base, Competition, Match, MatchStatus, Season, SeasonTeam, Team, User, UserRole
from routers import matches
from security import create_access_token


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.test_file = Path(__file__).parent / f"matches-{uuid4().hex}.sqlite"
        self.engine = create_engine(
            f"sqlite+pysqlite:///{self.test_file.as_posix()}",
            connect_args={"check_same_thread": False, "timeout": 15},
        )

        @event.listens_for(self.engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            users = [User(name=role.name, email=f"{index}@example.test", password_hash="unused", role=role)
                     for index, role in enumerate([UserRole.COACH, UserRole.COACH, UserRole.COACH,
                                                   UserRole.PLAYER, UserRole.FAN])]
            db.add_all(users)
            db.flush()
            self.coach, self.away_coach, self.other_coach, self.player, self.fan = [user.id for user in users]
            teams = [Team(name=f"Team {index}", coach_id=user.id) for index, user in enumerate(users[:3])]
            db.add_all(teams)
            competition = Competition(name="Isolated league")
            db.add(competition)
            db.flush()
            self.home, self.away, self.third = [team.id for team in teams]
            season = Season(name="2030 season", competition_id=competition.id,
                            start_date=date(2030, 1, 1), end_date=date(2030, 12, 31))
            db.add(season)
            db.flush()
            self.season = season.id
            db.add_all([SeasonTeam(season_id=season.id, team_id=team.id) for team in teams[:2]])
            db.commit()

        def isolated_db():
            with Session(self.engine) as db:
                yield db

        self.app = FastAPI()
        self.app.include_router(matches.router)
        self.app.dependency_overrides[get_db] = isolated_db
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()
        self.test_file.unlink(missing_ok=True)

    def headers(self, user_id=None):
        return {"Authorization": f"Bearer {create_access_token(user_id or self.coach)}"}

    def payload(self, **changes):
        return {"home_team_id": self.home, "away_team_id": self.away,
                "match_date": "2030-06-14T18:00:00+02:00", "location": "Main court",
                "season_id": self.season, **changes}

    def create(self, **changes):
        result = self.client.post("/matches", json=self.payload(**changes), headers=self.headers())
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_create_detail_options_and_public_read(self):
        created = self.create()
        self.assertEqual(created["status"], "SCHEDULED")
        self.assertEqual(created["home_team"]["id"], self.home)
        self.assertEqual(created["season"]["id"], self.season)
        self.assertIsNone(created["home_score"])
        for user in (self.player, self.fan, self.away_coach):
            response = self.client.get(f"/matches/{created['id']}", headers=self.headers(user))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["can_manage"], user == self.away_coach)
        options = self.client.get("/matches/options", headers=self.headers(self.fan)).json()
        self.assertEqual(len(options["teams"]), 3)
        self.assertNotIn("invitation_code", options["teams"][0])
        self.assertEqual(options["seasons"][0]["team_ids"], [self.home, self.away])

    def test_away_coach_can_create_and_manage_without_a_season(self):
        response = self.client.post("/matches", json=self.payload(season_id=None), headers=self.headers(self.away_coach))
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["can_manage"])
        self.assertIsNone(response.json()["season"])
        match_id = response.json()["id"]
        changed = self.client.patch(f"/matches/{match_id}", json={"location": None}, headers=self.headers(self.away_coach))
        self.assertEqual(changed.status_code, 200)
        self.assertIsNone(changed.json()["location"])

    def test_filters_order_pagination_and_timezone(self):
        first = self.create()
        second = self.create(match_date="2030-07-01T10:00:00Z", season_id=None)
        self.client.patch(f"/matches/{second['id']}/cancel", headers=self.headers())
        response = self.client.get("/matches", params={"team_id": self.away, "limit": 1}, headers=self.headers(self.fan)).json()
        self.assertEqual(response["total"], 2)
        self.assertEqual(response["items"][0]["id"], first["id"])
        page = self.client.get("/matches?limit=1&offset=1", headers=self.headers()).json()
        self.assertEqual(page["items"][0]["id"], second["id"])
        for params in ({"season_id": self.season}, {"status": "SCHEDULED"},
                       {"date_from": "2030-06-01T00:00:00Z", "date_to": "2030-07-01T00:00:00Z"}):
            listed = self.client.get("/matches", params=params, headers=self.headers()).json()
            self.assertEqual([item["id"] for item in listed["items"]], [first["id"]])
        self.assertTrue(first["match_date"].endswith("16:00:00Z"))

    def test_edit_and_finish_only_scheduled(self):
        match_id = self.create()["id"]
        updated = self.client.patch(f"/matches/{match_id}", json={"location": "  New court  ",
                "match_date": "2030-08-10T17:00:00Z", "season_id": None}, headers=self.headers(self.away_coach))
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["location"], "New court")
        self.assertIsNone(updated.json()["season"])
        finished = self.client.patch(f"/matches/{match_id}/result", json={"home_score": 0, "away_score": 89}, headers=self.headers())
        self.assertEqual(finished.status_code, 200)
        self.assertEqual(finished.json()["status"], "FINISHED")
        for suffix, body in (("", {"location": "Changed"}), ("/result", {"home_score": 1, "away_score": 2}), ("/cancel", None)):
            response = self.client.patch(f"/matches/{match_id}{suffix}", json=body, headers=self.headers())
            self.assertEqual(response.status_code, 409)

    def test_cancel_preserves_record_and_rejects_result(self):
        match_id = self.create()["id"]
        response = self.client.patch(f"/matches/{match_id}/cancel", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "CANCELLED")
        for suffix, body in (("/result", {"home_score": 10, "away_score": 20}), ("", {"location": None}), ("/cancel", None)):
            self.assertEqual(self.client.patch(f"/matches/{match_id}{suffix}", json=body, headers=self.headers()).status_code, 409)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Match)), 1)
            self.assertIsNone(db.get(Match, match_id).home_score)

    def test_cancellation_preserves_existing_related_records(self):
        from models import MatchAvailability, PlayerProfile, PlayerStats
        match_id = self.create()["id"]
        with Session(self.engine) as db:
            db.add(PlayerProfile(user_id=self.player, team_id=self.home))
            db.flush()
            db.add_all([MatchAvailability(match_id=match_id, player_id=self.player),
                        PlayerStats(match_id=match_id, player_id=self.player, points=7)])
            db.commit()
        response = self.client.patch(f"/matches/{match_id}/cancel", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(MatchAvailability)), 1)
            self.assertEqual(db.scalar(select(PlayerStats.points).where(PlayerStats.match_id == match_id)), 7)
            self.assertIsNotNone(db.get(User, self.player))
            self.assertIsNotNone(db.get(PlayerProfile, self.player))

    def test_permissions_and_missing_resources(self):
        match_id = self.create()["id"]
        self.assertEqual(self.client.get("/matches").status_code, 401)
        self.assertEqual(self.client.get("/matches/options").status_code, 401)
        for user in (self.other_coach, self.player, self.fan):
            headers = self.headers(user)
            self.assertEqual(self.client.post("/matches", json=self.payload(), headers=headers).status_code, 403)
            for suffix, body in (("", {"location": "X"}), ("/result", {"home_score": 1, "away_score": 2}), ("/cancel", None)):
                self.assertEqual(self.client.patch(f"/matches/{match_id}{suffix}", json=body, headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/matches/999", headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.patch("/matches/999/cancel", headers=self.headers()).status_code, 404)
        for body in (self.payload(away_team_id=999), self.payload(season_id=999)):
            self.assertEqual(self.client.post("/matches", json=body, headers=self.headers()).status_code, 404)

    def test_invalid_values_and_protected_fields(self):
        for changes in ({"away_team_id": self.home}, {"match_date": "2030-01-01T12:00:00"},
                        {"match_date": "2029-01-01T12:00:00Z"}, {"away_team_id": self.third},
                        {"location": "x" * 151}, {"status": "FINISHED"}, {"home_score": 10}):
            response = self.client.post("/matches", json=self.payload(**changes), headers=self.headers())
            self.assertEqual(response.status_code, 422, response.text)
        match_id = self.create()["id"]
        for payload in ({}, {"match_date": None}, {"home_team_id": self.third}, {"status": "FINISHED"},
                        {"season_id": 999}, {"match_date": "2031-01-01T00:00:00Z"}):
            response = self.client.patch(f"/matches/{match_id}", json=payload, headers=self.headers())
            self.assertEqual(response.status_code, 404 if payload.get("season_id") == 999 else 422, response.text)
        for score in (-1, True, 1.5, 2147483648, "12"):
            self.assertEqual(self.client.patch(f"/matches/{match_id}/result", json={"home_score": score, "away_score": 0},
                                               headers=self.headers()).status_code, 422)
        for query in ("status=INVALID", "team_id=0", "limit=201", "date_from=2030-01-01T00:00:00",
                      "date_from=2030-02-01T00:00:00Z&date_to=2030-01-01T00:00:00Z"):
            self.assertEqual(self.client.get(f"/matches?{query}", headers=self.headers()).status_code, 422)

    def test_failed_commit_rolls_back(self):
        from sqlalchemy.exc import IntegrityError
        with patch("routers.matches.Session.commit", side_effect=IntegrityError("test", {}, Exception("conflict"))):
            response = self.client.post("/matches", json=self.payload(), headers=self.headers())
            self.assertEqual(response.status_code, 409)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Match)), 0)

    def test_failed_result_commit_preserves_scheduled_state(self):
        from sqlalchemy.exc import IntegrityError
        match_id = self.create()["id"]
        with patch("routers.matches.Session.commit", side_effect=IntegrityError("test", {}, Exception("conflict"))):
            response = self.client.patch(f"/matches/{match_id}/result", json={"home_score": 10, "away_score": 20}, headers=self.headers())
            self.assertEqual(response.status_code, 409)
        with Session(self.engine) as db:
            match = db.get(Match, match_id)
            self.assertEqual(match.status, MatchStatus.SCHEDULED)
            self.assertIsNone(match.home_score)

    def test_main_app_registers_match_router(self):
        from main import app
        schema = app.openapi()
        for path in ("/matches", "/matches/options", "/matches/{match_id}",
                     "/matches/{match_id}/result", "/matches/{match_id}/cancel"):
            self.assertIn(path, schema["paths"])

    def test_concurrent_finish_and_cancel_have_one_winner(self):
        match_id = self.create()["id"]
        barrier = Barrier(2)
        original = matches._editable_match

        def synchronize(*args, **kwargs):
            match = original(*args, **kwargs)
            barrier.wait(timeout=10)
            return match

        with patch("routers.matches._editable_match", side_effect=synchronize), ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(self.client.patch, f"/matches/{match_id}/result",
                                       json={"home_score": 80, "away_score": 75}, headers=self.headers()),
                       executor.submit(self.client.patch, f"/matches/{match_id}/cancel", headers=self.headers(self.away_coach))]
            responses = [future.result(timeout=20) for future in futures]
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409], [r.text for r in responses])
        with Session(self.engine) as db:
            match = db.get(Match, match_id)
            self.assertIn(match.status, (MatchStatus.FINISHED, MatchStatus.CANCELLED))
            self.assertEqual(match.home_score is None, match.status == MatchStatus.CANCELLED)

    def test_postgresql_lock_targets_only_matches(self):
        with Session(self.engine) as db:
            original = db.scalar
            captured = []

            def capture(statement):
                captured.append(str(statement.compile(dialect=postgresql.dialect())))
                return original(statement)

            match_id = self.create()["id"]
            with patch.object(db, "scalar", side_effect=capture):
                matches._get_match(match_id, db, lock=True)
            self.assertIn("FOR UPDATE OF matches", captured[0])


if __name__ == "__main__":
    unittest.main()
