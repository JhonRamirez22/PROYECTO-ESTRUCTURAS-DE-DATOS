"""Login y sesiones compatibles con los contratos existentes de la PWA."""

from __future__ import annotations

import json
import re
import time
from typing import Annotated
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import JSONResponse

from app.core.auth import (
    SESSION_MAX_AGE_SECONDS,
    SessionClaims,
    SessionRole,
    cleared_session_cookie,
    create_session_token,
    matches_access_code,
    read_session_token,
    session_cookie,
    verify_courier_access_code,
    verify_session_token,
)
from app.db.session import get_session
from app.repositories.courier_repository import CourierRepository
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    PageAccessResponse,
    SessionResponse,
)
from app.settings import Settings, get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
DEVELOPMENT_DISPATCHER_CODE = "rutas-pasto-local-dispatcher-code"
DEVELOPMENT_SESSION_SECRET = "rutas-pasto-local-session-secret-not-for-production"
_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


@router.post("/login", response_model=LoginResponse, response_model_by_alias=True)
async def login(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JSONResponse:
    try:
        body: object = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _error("El body debe ser JSON válido.", 400)
    if not isinstance(body, dict):
        return _error("El body debe ser un objeto JSON.", 400)

    access_code = body.get("accessCode")
    if not isinstance(access_code, str) or not access_code:
        return _error("Ingresa tu código privado de acceso.", 400)
    if len(access_code) > 512:
        return _error("El código de acceso no es válido.", 401)
    try:
        login_request = LoginRequest.model_validate(
            {
                "accessCode": access_code,
                "returnTo": body.get("returnTo")
                if isinstance(body.get("returnTo"), str)
                else None,
            }
        )
    except ValidationError:
        return _error("Ingresa tu código privado de acceso.", 400)
    access_code = login_request.access_code

    settings = get_settings()
    secret = _configured_secret(settings)
    if secret is None:
        return _error(
            "El acceso no está configurado: falta AUTH_SECRET (mínimo 32 bytes).", 503
        )

    dispatcher_code = _dispatcher_code(settings)
    if not dispatcher_code or (
        not settings.is_development and len(dispatcher_code.encode("utf-8")) < 32
    ):
        return _error("El acceso de personal no está configurado correctamente.", 503)

    if matches_access_code(access_code, dispatcher_code):
        role: SessionRole = "dispatcher"
        courier_id: str | None = None
    else:
        courier_id = await _verify_courier_login(access_code, session)
        if courier_id is None:
            return _error("Código de acceso inválido.", 401)
        role = "courier"

    expires_at = int(time.time()) + SESSION_MAX_AGE_SECONDS
    token = create_session_token(role, expires_at, secret, courier_id)
    payload = LoginResponse(
        authenticated=True,
        redirect_to=_safe_redirect_target(role, login_request.return_to),
    )
    response = JSONResponse(
        content=payload.model_dump(by_alias=True),
        headers={
            "Set-Cookie": session_cookie(token, settings.node_env == "production"),
            "Cache-Control": "no-store, private",
        },
    )
    return response


@router.get("/session", response_model=SessionResponse)
async def read_session(request: Request) -> JSONResponse:
    settings = get_settings()
    claims = verify_session_token(
        read_session_token(request.headers.get("cookie")),
        _configured_secret(settings),
    )
    payload = SessionResponse(authenticated=claims is not None)
    return JSONResponse(
        content=payload.model_dump(),
        headers={"Cache-Control": "no-store, private"},
    )


@router.get("/access", response_model=PageAccessResponse, response_model_by_alias=True)
async def check_page_access(
    request: Request,
    path: Annotated[str, Query(min_length=1, max_length=256)],
) -> PageAccessResponse:
    claims = get_optional_session(request)
    if path == "/acceso":
        if claims is None:
            return PageAccessResponse(allowed=True)
        return PageAccessResponse(allowed=False, redirect_to=_home_for_role(claims["role"]))

    required_role = _required_page_role(path)
    if required_role is None:
        raise HTTPException(status_code=400, detail="La ruta no requiere una sesión de rol.")
    if claims is None:
        return PageAccessResponse(allowed=False, redirect_to="/acceso")
    if claims["role"] == required_role:
        return PageAccessResponse(allowed=True)
    return PageAccessResponse(allowed=False, redirect_to=_home_for_role(claims["role"]))


@router.post("/logout", response_model=LogoutResponse)
async def logout() -> JSONResponse:
    settings = get_settings()
    return JSONResponse(
        content={"ok": True},
        headers={
            "Set-Cookie": cleared_session_cookie(settings.node_env == "production"),
            "Cache-Control": "no-store, private",
        },
    )


def get_optional_session(request: Request) -> SessionClaims | None:
    """Dependencia común para autorizar próximas rutas sin filtrar claims al cliente."""
    settings = get_settings()
    return verify_session_token(
        read_session_token(request.headers.get("cookie")),
        _configured_secret(settings),
    )


def require_dispatcher_session(request: Request) -> SessionClaims:
    claims = get_optional_session(request)
    if claims is None:
        raise HTTPException(
            status_code=401,
            detail="Debes iniciar sesión para continuar.",
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )
    if claims["role"] != "dispatcher":
        raise HTTPException(
            status_code=403,
            detail="Se requiere una sesión de despacho.",
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )
    return claims


def require_courier_session(request: Request) -> SessionClaims:
    claims = get_optional_session(request)
    if claims is None:
        raise HTTPException(
            status_code=401,
            detail="Debes iniciar sesión para continuar.",
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )
    if claims["role"] != "courier" or not claims.get("courierId"):
        raise HTTPException(
            status_code=403,
            detail="Se requiere una sesión de repartidor.",
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )
    return claims


async def _verify_courier_login(access_code: str, session: AsyncSession) -> str | None:
    courier_id, separator, secret_part = access_code.partition(".")
    if not separator or not _UUID_PATTERN.fullmatch(courier_id) or len(secret_part) < 40:
        return None

    courier_uuid = UUID(courier_id)
    credential = await CourierRepository(session).get_credential(courier_uuid)
    if credential is None:
        return None
    if not await run_in_threadpool(
        verify_courier_access_code, access_code, credential.access_code_hash
    ):
        return None
    return str(courier_uuid)


def _configured_secret(settings: Settings) -> str | None:
    secret = (
        settings.auth_secret.get_secret_value().strip()
        if settings.auth_secret is not None
        else None
    )
    if secret is None and settings.is_development:
        secret = DEVELOPMENT_SESSION_SECRET
    if secret is None or len(secret.encode("utf-8")) < 32:
        return None
    return secret


def _dispatcher_code(settings: Settings) -> str | None:
    access_code = (
        settings.dispatcher_access_code.get_secret_value().strip()
        if settings.dispatcher_access_code is not None
        else None
    )
    if access_code is None and settings.is_development:
        return DEVELOPMENT_DISPATCHER_CODE
    return access_code


def _required_page_role(path: str) -> SessionRole | None:
    if path == "/dashboard" or path.startswith("/dashboard/"):
        return "dispatcher"
    if path == "/pedidos" or path.startswith("/pedidos/"):
        return "dispatcher"
    if path == "/repartidor" or path.startswith("/repartidor/"):
        return "courier"
    return None


def _home_for_role(role: SessionRole) -> str:
    return "/dashboard" if role == "dispatcher" else "/repartidor"


def _safe_redirect_target(role: SessionRole, value: object) -> str:
    fallback = "/dashboard" if role == "dispatcher" else "/repartidor"
    if not isinstance(value, str) or not value.startswith("/"):
        return fallback
    if value.startswith("//") or "\\" in value:
        return fallback

    target = urlsplit(value)
    path = target.path
    if role == "dispatcher":
        allowed = path == "/dashboard" or path.startswith("/dashboard/")
        allowed = allowed or path == "/pedidos" or path.startswith("/pedidos/")
    else:
        allowed = path == "/repartidor" or path.startswith("/repartidor/")
    if not allowed or target.scheme or target.netloc:
        return fallback
    return urlunsplit(("", "", path, target.query, target.fragment))


def _error(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        content={"error": message},
        status_code=status_code,
        headers={"Cache-Control": "no-store, private"},
    )
