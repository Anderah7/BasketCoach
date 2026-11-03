from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, ConfigDict
from models import UserRole

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