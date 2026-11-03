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
