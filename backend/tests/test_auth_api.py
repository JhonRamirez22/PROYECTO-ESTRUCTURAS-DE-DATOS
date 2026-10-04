from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.auth import _configured_secret, _dispatcher_code
from app.core.auth import create_courier_access_code, hash_courier_access_code
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models import Courier, CourierCredential, CourierStatus
from app.settings import Settings, get_settings

DISPATCHER_CODE = "unit-test-dispatcher-access-code-32-chars"
SESSION_SECRET = "unit-test-session-secret-with-at-least-32-bytes"


def test_missing_environment_defaults_to_production_without_local_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("NODE_ENV", "AUTH_SECRET", "DISPATCHER_ACCESS_CODE"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)

    assert settings.node_env == "production"
    assert not settings.is_development
    assert _configured_secret(settings) is None
    assert _dispatcher_code(settings) is None


@pytest_asyncio.fixture
async def session_factory(tmp_path: Path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'auth.sqlite'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    monkeypatch.setenv("AUTH_SECRET", SESSION_SECRET)
    monkeypatch.setenv("DISPATCHER_ACCESS_CODE", DISPATCHER_CODE)
    monkeypatch.setenv("NODE_ENV", "test")
    get_settings.cache_clear()

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_login_rejects_invalid_json_and_non_object_body(
    client: httpx.AsyncClient,
) -> None:
    malformed = await client.post("/api/auth/login", content="{")
    null_body = await client.post(
        "/api/auth/login", content="null", headers={"Content-Type": "application/json"}
    )

    assert malformed.status_code == 400
    assert malformed.json() == {"error": "El body debe ser JSON válido."}
    assert null_body.status_code == 400
    assert null_body.json() == {"error": "El body debe ser un objeto JSON."}


@pytest.mark.asyncio
async def test_dispatcher_login_sets_private_cookie_and_does_not_disclose_claims(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/auth/login",
        json={
            "role": "courier",
            "accessCode": DISPATCHER_CODE,
            "returnTo": "/repartidor",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "redirectTo": "/dashboard"}
    assert "rutas-pasto-session=" in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=Strict" in response.headers["set-cookie"]
    assert response.headers["cache-control"] == "no-store, private"
    assert "role" not in response.json()
    assert "courierId" not in response.json()

    session_response = await client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": True}
    assert session_response.headers["cache-control"] == "no-store, private"


@pytest.mark.asyncio
async def test_page_access_is_decided_by_backend_without_exposing_role(
    client: httpx.AsyncClient,
) -> None:
    anonymous_access = await client.get("/api/auth/access", params={"path": "/dashboard"})
    anonymous_login = await client.get("/api/auth/access", params={"path": "/acceso"})
    assert anonymous_access.json() == {"allowed": False, "redirectTo": "/acceso"}
    assert anonymous_login.json() == {"allowed": True, "redirectTo": None}

    await client.post("/api/auth/login", json={"accessCode": DISPATCHER_CODE})
    dispatcher_access = await client.get("/api/auth/access", params={"path": "/dashboard"})
    courier_access = await client.get("/api/auth/access", params={"path": "/repartidor"})
    access_page = await client.get("/api/auth/access", params={"path": "/acceso"})

    assert dispatcher_access.json() == {"allowed": True, "redirectTo": None}
    assert courier_access.json() == {"allowed": False, "redirectTo": "/dashboard"}
    assert access_page.json() == {"allowed": False, "redirectTo": "/dashboard"}
    assert "role" not in courier_access.json()
    assert "courierId" not in courier_access.json()


@pytest.mark.asyncio
async def test_page_access_rejects_unmanaged_paths(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/auth/access", params={"path": "/api/pedidos"})

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_courier_login_verifies_database_hash_and_limits_redirect_scope(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    courier_id = "f8fbc95f-643e-4fb3-9b82-8c42e0707311"
    access_code = create_courier_access_code(courier_id)
    async with session_factory() as session:
        courier = Courier(
            id=UUID(courier_id),
            name="Repartidor de prueba",
            phone="3000000000",
            status=CourierStatus.AVAILABLE,
            credential=CourierCredential(access_code_hash=hash_courier_access_code(access_code)),
        )
        session.add(courier)
        await session.commit()

    response = await client.post(
        "/api/auth/login",
        json={"accessCode": access_code, "returnTo": "/dashboard"},
    )

    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "redirectTo": "/repartidor"}
    assert "courierId" not in response.json()
    assert "role" not in response.json()
    assert (await client.get("/api/auth/session")).json() == {"authenticated": True}


@pytest.mark.asyncio
async def test_invalid_code_and_logout_preserve_existing_http_contract(
    client: httpx.AsyncClient,
) -> None:
    invalid = await client.post("/api/auth/login", json={"accessCode": "incorrecto"})
    logout = await client.post("/api/auth/logout")

    assert invalid.status_code == 401
    assert invalid.json() == {"error": "Código de acceso inválido."}
    assert logout.status_code == 200
    assert logout.json() == {"ok": True}
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert "HttpOnly" in logout.headers["set-cookie"]
    assert logout.headers["cache-control"] == "no-store, private"


@pytest.mark.asyncio
async def test_external_return_to_is_rejected(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/auth/login",
        json={"accessCode": DISPATCHER_CODE, "returnTo": "//evil.example"},
    )

    assert response.json() == {"authenticated": True, "redirectTo": "/dashboard"}
