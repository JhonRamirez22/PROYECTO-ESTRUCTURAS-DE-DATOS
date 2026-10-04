"""Cliente TomTom con caché LRU, TTL y stale-if-error para tráfico vial."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from functools import lru_cache

import httpx

from app.core.location.pasto_area import is_within_pasto_service_area
from app.core.routing.contracts import Coordinate
from app.core.structures.doubly_linked_list import DoublyLinkedList, DoublyLinkedNode
from app.core.traffic.tomtom import TrafficData, parse_tomtom_flow_response
from app.settings import get_settings

_LOGGER = logging.getLogger(__name__)
TOMTOM_TRAFFIC_ENDPOINT = (
    "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
)
TRAFFIC_CACHE_TTL_SECONDS = 90
TRAFFIC_STALE_MAX_AGE_SECONDS = 10 * 60
TRAFFIC_CACHE_MAX_ENTRIES = 512
TRAFFIC_RATE_LIMIT_COOLDOWN_SECONDS = 60
MAX_CONCURRENT_TOMTOM_REQUESTS = 4


class TrafficServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class TrafficTimeoutError(TrafficServiceError):
    pass


class TrafficRateLimitError(TrafficServiceError):
    pass


class TrafficProviderError(TrafficServiceError):
    pass


@dataclass(frozen=True, slots=True)
class _TrafficCacheEntry:
    key: str
    fresh_until: float
    stale_until: float
    data: TrafficData


class TrafficService:
    """La caché vive en este singleton de proceso; no es persistente ni compartida entre workers."""

    def __init__(
        self,
        *,
        api_key: str,
        timeout_ms: int = 3_500,
        transport: httpx.AsyncBaseTransport | None = None,
        client: httpx.AsyncClient | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        utc_now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not api_key.strip():
            raise ValueError("TOMTOM_API_KEY debe configurarse para consultar tráfico.")
        if timeout_ms <= 0:
            raise ValueError("TOMTOM_TRAFFIC_TIMEOUT_MS debe ser positivo.")
        if transport is not None and client is not None:
            raise ValueError("No se puede inyectar transport y client al mismo tiempo.")
        self._api_key = api_key.strip()
        self._timeout_seconds = timeout_ms / 1_000
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=self._timeout_seconds,
            transport=transport,
        )
        self._monotonic = monotonic
        self._utc_now = utc_now
        self._cache: DoublyLinkedList[_TrafficCacheEntry] = DoublyLinkedList()
        self._cache_nodes: dict[str, DoublyLinkedNode[_TrafficCacheEntry]] = {}
        self._request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TOMTOM_REQUESTS)
        self._rate_limited_until = 0.0

    async def get_flow_segment(self, coordinate: Coordinate) -> TrafficData:
        longitude, latitude = coordinate
        if not is_within_pasto_service_area(latitude, longitude):
            raise ValueError(
                "El punto de tráfico debe estar dentro de la zona de servicio de Pasto."
            )

        key = build_traffic_cache_key(coordinate)
        now = self._monotonic()
        cached_node = self._cache_nodes.get(key)
        if cached_node is not None and cached_node.value.fresh_until > now:
            self._cache.move_to_front(cached_node)
            _LOGGER.info("TomTom Traffic cache hit")
            return replace(cached_node.value.data, cache_status="CACHE")
        if cached_node is not None and cached_node.value.stale_until <= now:
            self._remove_cache_node(key, cached_node)
            cached_node = None

        # TODO(MVP): coalescer consultas concurrentes iguales para evitar un thundering herd.
        if self._rate_limited_until > now:
            return self._use_stale_or_raise(
                cached_node,
                TrafficRateLimitError("TomTom Traffic está en pausa por HTTP 429.", 429),
            )

        try:
            async with self._request_semaphore:
                data = await self._fetch_flow_segment(latitude, longitude)
        except TrafficServiceError as error:
            if isinstance(error, TrafficRateLimitError):
                self._rate_limited_until = self._monotonic() + TRAFFIC_RATE_LIMIT_COOLDOWN_SECONDS
                _LOGGER.warning("TomTom Traffic rate limit; no se reintenta durante el cooldown")
            else:
                _LOGGER.warning(
                    "TomTom Traffic request failed",
                    extra={"error_type": type(error).__name__},
                )
            return self._use_stale_or_raise(cached_node, error)

        self._store(key, data)
        _LOGGER.info("TomTom Traffic cache miss")
        if data.road_closure:
            _LOGGER.warning("TomTom Traffic reportó una vía cerrada")
        return data

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _fetch_flow_segment(self, latitude: float, longitude: float) -> TrafficData:
        try:
            response = await self._client.get(
                TOMTOM_TRAFFIC_ENDPOINT,
                params={
                    "key": self._api_key,
                    "point": f"{latitude:.5f},{longitude:.5f}",
                    "unit": "kmph",
                },
            )
        except httpx.TimeoutException as error:
            raise TrafficTimeoutError(
                f"TomTom Traffic excedió el límite de {round(self._timeout_seconds * 1_000)} ms."
            ) from error
        except httpx.HTTPError as error:
            raise TrafficProviderError("No se pudo conectar con TomTom Traffic.") from error

        if response.status_code == 429:
            raise TrafficRateLimitError("TomTom Traffic respondió HTTP 429.", 429)
        if not response.is_success:
            raise TrafficProviderError(
                f"TomTom Traffic respondió HTTP {response.status_code}.", response.status_code
            )
        try:
            payload: object = response.json()
            return parse_tomtom_flow_response(payload, timestamp=self._utc_now())
        except (ValueError, TypeError) as error:
            raise TrafficProviderError("TomTom Traffic devolvió una respuesta inválida.") from error

    def _use_stale_or_raise(
        self,
        cached_node: DoublyLinkedNode[_TrafficCacheEntry] | None,
        error: TrafficServiceError,
    ) -> TrafficData:
        if cached_node is not None and cached_node.value.stale_until > self._monotonic():
            self._cache.move_to_front(cached_node)
            _LOGGER.warning("TomTom Traffic sirve el último dato válido del caché")
            return replace(cached_node.value.data, cache_status="STALE")
        raise error

    def _store(self, key: str, data: TrafficData) -> None:
        existing = self._cache_nodes.get(key)
        if existing is not None:
            self._cache.remove(existing)
        stored_at = self._monotonic()
        entry = _TrafficCacheEntry(
            key=key,
            fresh_until=stored_at + TRAFFIC_CACHE_TTL_SECONDS,
            stale_until=stored_at + TRAFFIC_STALE_MAX_AGE_SECONDS,
            data=data,
        )
        self._cache_nodes[key] = self._cache.appendleft(entry)
        while len(self._cache) > TRAFFIC_CACHE_MAX_ENTRIES:
            evicted = self._cache.pop_back()
            if evicted is not None:
                self._cache_nodes.pop(evicted.key, None)

    def _remove_cache_node(
        self,
        key: str,
        node: DoublyLinkedNode[_TrafficCacheEntry],
    ) -> None:
        self._cache.remove(node)
        self._cache_nodes.pop(key, None)


def build_traffic_cache_key(coordinate: Coordinate) -> str:
    """Redondea a 5 decimales (aprox. un metro en Pasto) para absorber jitter GPS."""
    longitude, latitude = coordinate
    return f"tomtom-flow-v1:{round(latitude, 5)},{round(longitude, 5)}"


@lru_cache(maxsize=1)
def get_traffic_service() -> TrafficService | None:
    settings = get_settings()
    api_key = (
        settings.tomtom_api_key.get_secret_value().strip()
        if settings.tomtom_api_key is not None
        else ""
    )
    if not api_key:
        return None
    return TrafficService(api_key=api_key, timeout_ms=settings.tomtom_traffic_timeout_ms)


async def close_traffic_service() -> None:
    service = get_traffic_service()
    if service is not None:
        await service.aclose()
    get_traffic_service.cache_clear()
