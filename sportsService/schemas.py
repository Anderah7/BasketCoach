from datetime import datetime, date
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, ConfigDict
from models import UserRole, PlayerPosition

class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6)
    role: UserRole

class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: datetime

class PlayerProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: PlayerPosition | None = None
    height_cm: int | None = Field(default=None, gt=0)
    weight_kg: Decimal | None = Field(default=None, gt=0, max_digits=5, decimal_places=2)
    birth_date: date | None = None

class PlayerProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    team_id: int | None
    jersey_number: int | None
    position: PlayerPosition | None
    height_cm: int | None
    weight_kg: Decimal | None
    birth_date: date | None
    strengths: str | None
    weaknesses: str | None

class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=60)

class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str | None
    coach_id: int | None
    invitation_code: str | None
    is_managed: bool
    created_at: datetime


class TeamJoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invitation_code: str = Field(min_length=1, max_length=32)


class JoinedTeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str | None


class TeamJoinResponse(BaseModel):
    message: str
    team: JoinedTeamResponse


class TeamPlayerResponse(BaseModel):
    user_id: int
    name: str
    jersey_number: int | None
    position: PlayerPosition | None
    height_cm: int | None
    weight_kg: Decimal | None
    strengths: str | None
    weaknesses: str | None


class PlayerProfileCoachUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jersey_number: int | None = Field(default=None, ge=0, le=99)
    strengths: str | None = None
    weaknesses: str | None = None
