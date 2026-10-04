"use client";

import MapLibreRouteMap, {
  type MapCourier,
  type MapDeliveryPoint,
  type MapRoute,
} from "@/components/MapLibreRouteMap";

interface RouteMapProps {
  couriers: MapCourier[];
  routes: MapRoute[];
  pendingPoints?: MapDeliveryPoint[];
  selectedCoordinate?: [number, number] | null;
  onMapClick?: (coordinate: { lat: number; lng: number }) => void;
}

export default function RouteMap(props: RouteMapProps) {
  return <MapLibreRouteMap {...props} ariaLabel="Mapa de rutas" />;
}
