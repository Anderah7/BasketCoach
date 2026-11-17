"""Authenticated calendar. Either participating team's coach may manage a scheduled match."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from database import get_db
from models import Match, MatchStatus, Season, SeasonTeam, Team, User, UserRole
from schemas import (
    MatchCreate, MatchOptionsResponse, MatchResponse, MatchResultUpdate,
    MatchSeasonOption, MatchesResponse, MatchTeamResponse, MatchUpdate,
)
from security import get_current_user

router = APIRouter(prefix="/matches", tags=["Matches"])


def _can_manage(match: Match, user: User) -> bool:
    return user.role == UserRole.COACH and user.id in {
        match.home_team.coach_id, match.away_team.coach_id,
    }


def _response(match: Match, user: User) -> MatchResponse:
    # PostgreSQL returns aware datetimes; SQLite's isolated tests do not.
    match_date = match.match_date
    if match_date.tzinfo is None:
        match_date = match_date.replace(tzinfo=timezone.utc)
    return MatchResponse(
        id=match.id, home_team=match.home_team, away_team=match.away_team,
        match_date=match_date, location=match.location, season=match.season,
        home_score=match.home_score, away_score=match.away_score,
        status=match.status, can_manage=_can_manage(match, user),
    )


def _get_match(match_id: int, db: Session, *, lock: bool = False) -> Match:
    query = select(Match).where(Match.id == match_id).options(
        joinedload(Match.home_team), joinedload(Match.away_team), joinedload(Match.season),
    ).execution_options(populate_existing=True)
    if lock:
        # Lock only the match, not nullable outer-joined Season rows.
        query = query.with_for_update(of=Match)
    match = db.scalar(query)
    if match is None:
        raise HTTPException(404, "Match not found")
    return match


def _editable_match(match_id: int, user: User, db: Session) -> Match:
    if user.role != UserRole.COACH:
        raise HTTPException(403, "Only coaches can manage matches")
    match = _get_match(match_id, db, lock=True)
    if not _can_manage(match, user):
        raise HTTPException(403, "You must coach a participating team to manage this match")
    if match.status != MatchStatus.SCHEDULED:
        raise HTTPException(409, "Only scheduled matches can be changed")
    return match


def _validate_season(season_id: int | None, team_ids: set[int], match_date: datetime, db: Session):
    if season_id is None:
        return
    season = db.scalar(select(Season).where(Season.id == season_id).with_for_update())
    if season is None:
        raise HTTPException(404, "Season not found")
    if season.start_date > season.end_date:
        raise HTTPException(422, "Season dates are invalid")
    if not season.start_date <= match_date.astimezone(timezone.utc).date() <= season.end_date:
        raise HTTPException(422, "Match date must fall within the season (UTC)")
    participants = set(db.scalars(
        select(SeasonTeam.team_id).where(
            SeasonTeam.season_id == season_id, SeasonTeam.team_id.in_(team_ids),
        ).order_by(SeasonTeam.team_id).with_for_update()
    ))
    if participants != team_ids:
        raise HTTPException(422, "Both teams must participate in the selected season")


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Match data conflicts with existing records") from exc


def _save_scheduled(match: Match, values: dict, user: User, db: Session):
    # The row lock serializes all three writes. The predicate also protects a
    # stale state transition if the storage backend does not implement row locks.
    try:
        changed = db.execute(
            update(Match).where(Match.id == match.id, Match.status == MatchStatus.SCHEDULED)
            .values(**values).execution_options(synchronize_session=False)
        ).rowcount
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Match data conflicts with existing records") from exc
    if changed != 1:
        db.rollback()
        raise HTTPException(409, "The match has already been finished or cancelled; refresh the calendar")
    _commit(db)
    return _response(_get_match(match.id, db), user)


@router.get("/options", response_model=MatchOptionsResponse)
def calendar_options(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    teams = db.scalars(select(Team).order_by(Team.name, Team.id)).all()
    seasons = db.scalars(select(Season).options(selectinload(Season.season_teams))
                         .order_by(Season.start_date.desc(), Season.id)).all()
    return MatchOptionsResponse(
        teams=[MatchTeamResponse.model_validate(team) for team in teams],
        seasons=[MatchSeasonOption(
            id=season.id, name=season.name, start_date=season.start_date, end_date=season.end_date,
            team_ids=sorted(link.team_id for link in season.season_teams),
        ) for season in seasons],
    )


@router.post("", response_model=MatchResponse, status_code=status.HTTP_201_CREATED)
def create_match(
    data: MatchCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    if current_user.role != UserRole.COACH:
        raise HTTPException(403, "Only coaches can manage matches")
    team_ids = {data.home_team_id, data.away_team_id}
    teams = {team.id: team for team in db.scalars(
        select(Team).where(Team.id.in_(team_ids)).order_by(Team.id).with_for_update()
    )}
    if set(teams) != team_ids:
        raise HTTPException(404, "One or both teams were not found")
    if not any(team.coach_id == current_user.id for team in teams.values()):
        raise HTTPException(403, "You must coach a participating team to manage this match")
    match_date = data.match_date.astimezone(timezone.utc)
    _validate_season(data.season_id, team_ids, match_date, db)
    match = Match(**data.model_dump(exclude={"match_date"}), match_date=match_date, status=MatchStatus.SCHEDULED)
    db.add(match)
    _commit(db)
    return _response(_get_match(match.id, db), current_user)


@router.get("", response_model=MatchesResponse)
def list_matches(
    team_id: int | None = Query(default=None, gt=0),
    season_id: int | None = Query(default=None, gt=0),
    status: MatchStatus | None = None,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200), offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    filters = []
    if team_id is not None:
        if db.get(Team, team_id) is None:
            raise HTTPException(404, "Team not found")
        filters.append(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
    if season_id is not None:
        if db.get(Season, season_id) is None:
            raise HTTPException(404, "Season not found")
        filters.append(Match.season_id == season_id)
    if status is not None:
        filters.append(Match.status == status)
    for boundary in (date_from, date_to):
        if boundary is not None and boundary.utcoffset() is None:
            raise HTTPException(422, "Calendar boundaries must include a timezone")
    if date_from is not None and date_to is not None and date_from >= date_to:
        raise HTTPException(422, "date_from must precede date_to")
    if date_from is not None:
        filters.append(Match.match_date >= date_from)
    if date_to is not None:
        filters.append(Match.match_date < date_to)
    total = db.scalar(select(func.count()).select_from(Match).where(*filters))
    matches = db.scalars(select(Match).where(*filters).options(
        joinedload(Match.home_team), joinedload(Match.away_team), joinedload(Match.season),
    ).order_by(Match.match_date, Match.id).offset(offset).limit(limit)).all()
    return MatchesResponse(items=[_response(match, current_user) for match in matches],
                           total=total, limit=limit, offset=offset)


@router.get("/{match_id}", response_model=MatchResponse)
def match_detail(
    match_id: int = Path(gt=0), current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return _response(_get_match(match_id, db), current_user)


@router.patch("/{match_id}", response_model=MatchResponse)
def edit_match(
    data: MatchUpdate, match_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    match = _editable_match(match_id, current_user, db)
    values = data.model_dump(exclude_unset=True)
    match_date = values.get("match_date", match.match_date)
    if match_date.tzinfo is None:
        match_date = match_date.replace(tzinfo=timezone.utc)
    if "match_date" in values:
        values["match_date"] = match_date.astimezone(timezone.utc)
    _validate_season(values.get("season_id", match.season_id),
                     {match.home_team_id, match.away_team_id}, match_date, db)
    return _save_scheduled(match, values, current_user, db)


@router.patch("/{match_id}/result", response_model=MatchResponse)
def record_result(
    data: MatchResultUpdate, match_id: int = Path(gt=0),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    match = _editable_match(match_id, current_user, db)
    return _save_scheduled(match, {**data.model_dump(), "status": MatchStatus.FINISHED}, current_user, db)


@router.patch("/{match_id}/cancel", response_model=MatchResponse)
def cancel_match(
    match_id: int = Path(gt=0), current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    match = _editable_match(match_id, current_user, db)
    return _save_scheduled(match, {"status": MatchStatus.CANCELLED}, current_user, db)
