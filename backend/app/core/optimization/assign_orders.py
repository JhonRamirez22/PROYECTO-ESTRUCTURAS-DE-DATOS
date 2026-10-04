"""Asignación determinista de pedidos por cercanía y balance de carga."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

MAX_ASSIGNABLE_ORDERS_PER_ROUTE = 50
MAX_LOAD_MULTIPLIER = 1.5
MIN_TRAFFIC_MULTIPLIER = 0.5
MAX_TRAFFIC_MULTIPLIER = 3.0


@dataclass(frozen=True, slots=True)
class Coordinates:
    lat: float
    lng: float


@dataclass(frozen=True, slots=True)
class CourierPosition:
    courier_id: str
    coordinates: Coordinates
    available: bool = True


@dataclass(frozen=True, slots=True)
class OrderPoint:
    order_id: str
    coordinates: Coordinates


@dataclass(frozen=True, slots=True)
class AssignmentAdjustment:
    courier_id: str
    order_id: str
    traffic_multiplier: float


@dataclass(frozen=True, slots=True)
class AssignOrdersOptions:
    adjustments: Sequence[AssignmentAdjustment] = ()


def assign_orders(
    couriers: Sequence[CourierPosition],
    orders: Sequence[OrderPoint],
    options: AssignOrdersOptions | None = None,
) -> dict[str, list[str]]:
    """Asigna por distancia euclidiana aproximada y luego limita cargas altas.

    La distancia euclidiana sirve como clustering barato; consultar el motor
    vial por cada pareja haría N*M solicitudes y no mejora esta primera pasada.
    """
    _validate_unique_ids(couriers, orders)
    _validate_coordinates(couriers, orders)
    if options is None:
        options = AssignOrdersOptions()
    available = [courier for courier in couriers if courier.available]
    assignments: dict[str, list[str]] = {courier.courier_id: [] for courier in available}
    if not available or not orders:
        return assignments

    adjustment_map = _build_adjustment_map(options.adjustments)
    orders_by_id = {order.order_id: order for order in orders}

    for order in orders:
        eligible = [
            courier
            for courier in available
            if len(assignments[courier.courier_id]) < MAX_ASSIGNABLE_ORDERS_PER_ROUTE
        ]
        if not eligible:
            break

        nearest = min(
            eligible,
            key=lambda courier: _assignment_cost(
                courier.coordinates,
                order.coordinates,
                adjustment_map.get((courier.courier_id, order.order_id), 1.0),
            ),
        )
        assignments[nearest.courier_id].append(order.order_id)

    _balance_assignments(assignments, available, orders_by_id, adjustment_map)
    return assignments


def _balance_assignments(
    assignments: dict[str, list[str]],
    couriers: Sequence[CourierPosition],
    orders_by_id: dict[str, OrderPoint],
    adjustment_map: dict[tuple[str, str], float],
) -> None:
    average_load = len(orders_by_id) / len(couriers)
    maximum_load = min(
        max(1, math.floor(average_load * MAX_LOAD_MULTIPLIER)),
        MAX_ASSIGNABLE_ORDERS_PER_ROUTE,
    )

    while True:
        overloaded = max(
            (
                courier
                for courier in couriers
                if len(assignments[courier.courier_id]) > maximum_load
            ),
            key=lambda courier: len(assignments[courier.courier_id]),
            default=None,
        )
        if overloaded is None:
            return

        destination = min(
            (
                courier
                for courier in couriers
                if courier.courier_id != overloaded.courier_id
                and len(assignments[courier.courier_id]) < maximum_load
            ),
            key=lambda courier: len(assignments[courier.courier_id]),
            default=None,
        )
        if destination is None:
            return

        current_orders = assignments[overloaded.courier_id]
        # Mover primero el pedido más cercano al nuevo repartidor reduce el desvío.
        order_to_move = min(
            current_orders,
            key=lambda order_id: _assignment_cost(
                destination.coordinates,
                orders_by_id[order_id].coordinates,
                adjustment_map.get((destination.courier_id, order_id), 1.0),
            ),
            default=None,
        )
        if order_to_move is None:
            return

        current_orders.remove(order_to_move)
        assignments[destination.courier_id].append(order_to_move)


def _build_adjustment_map(
    adjustments: Sequence[AssignmentAdjustment],
) -> dict[tuple[str, str], float]:
    result: dict[tuple[str, str], float] = {}
    for adjustment in adjustments:
        multiplier = adjustment.traffic_multiplier
        if (
            not math.isfinite(multiplier)
            or not MIN_TRAFFIC_MULTIPLIER <= multiplier <= MAX_TRAFFIC_MULTIPLIER
        ):
            raise ValueError(
                "traffic_multiplier debe estar entre "
                f"{MIN_TRAFFIC_MULTIPLIER} y {MAX_TRAFFIC_MULTIPLIER}"
            )

        key = (adjustment.courier_id, adjustment.order_id)
        if key in result:
            raise ValueError(
                "No puede haber más de un ajuste para "
                f"{adjustment.courier_id}/{adjustment.order_id}"
            )
        result[key] = multiplier
    return result


def _assignment_cost(
    courier_coordinates: Coordinates,
    order_coordinates: Coordinates,
    traffic_multiplier: float = 1.0,
) -> float:
    latitude_difference = courier_coordinates.lat - order_coordinates.lat
    longitude_difference = courier_coordinates.lng - order_coordinates.lng
    return (latitude_difference**2 + longitude_difference**2) * traffic_multiplier


def _validate_unique_ids(
    couriers: Sequence[CourierPosition],
    orders: Sequence[OrderPoint],
) -> None:
    if len({courier.courier_id for courier in couriers}) != len(couriers):
        raise ValueError("Los courier_id deben ser únicos")
    if len({order.order_id for order in orders}) != len(orders):
        raise ValueError("Los order_id deben ser únicos")


def _validate_coordinates(
    couriers: Sequence[CourierPosition],
    orders: Sequence[OrderPoint],
) -> None:
    for coordinates in [courier.coordinates for courier in couriers] + [
        order.coordinates for order in orders
    ]:
        if (
            not math.isfinite(coordinates.lat)
            or not math.isfinite(coordinates.lng)
            or not -90 <= coordinates.lat <= 90
            or not -180 <= coordinates.lng <= 180
        ):
            raise ValueError("Las coordenadas deben ser lat/lng finitas dentro del rango global")
