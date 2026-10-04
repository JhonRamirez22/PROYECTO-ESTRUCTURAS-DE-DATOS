"""Contratos HTTP de autenticación."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    access_code: str = Field(alias="accessCode", min_length=1, max_length=512)
    return_to: str | None = Field(default=None, alias="returnTo")


class LoginResponse(BaseModel):
    authenticated: bool
    redirect_to: str = Field(serialization_alias="redirectTo")


class SessionResponse(BaseModel):
    authenticated: bool


class PageAccessResponse(BaseModel):
    allowed: bool
    redirect_to: str | None = Field(default=None, serialization_alias="redirectTo")


class LogoutResponse(BaseModel):
    ok: bool
