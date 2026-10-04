"use client";

import MapLibreRouteMap, {
  type MapCourier,
  type MapRoute,
} from "@/components/MapLibreRouteMap";

export interface CourierRouteMapData {
  courier: {
    currentLat: number | null;
    currentLng: number | null;
  };
  deliveryPoints: Array<{
    id: string;
    address: string;
    lat: number;
    lng: number;
    sequenceIndex: number | null;
    status: "PENDING" | "EN_ROUTE" | "DELIVERED" | "FAILED";
  }>;
  geometryProvider: "OSRM" | "ORS" | null;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  } | null;
}

interface CurrentLocation {
  lat: number;
  lng: number;
}

interface CourierRouteMapProps {
  currentLocation: CurrentLocation | null;
  route: CourierRouteMapData;
}

export default function CourierRouteMap({
  currentLocation,
  route,
}: CourierRouteMapProps) {
  const courier: MapCourier = {
    id: "current-courier",
    name: "Tu ubicación",
    currentLat: currentLocation?.lat ?? route.courier.currentLat,
    currentLng: currentLocation?.lng ?? route.courier.currentLng,
  };
  const mapRoute: MapRoute = {
    id: "assigned-route",
    courier,
    deliveryPoints: route.deliveryPoints,
    geometryProvider: route.geometryProvider,
    geometry: route.geometry,
  };

  return (
    <MapLibreRouteMap
      ariaLabel="Mapa de mi ruta"
      className="h-[340px] w-full"
      couriers={[courier]}
      routes={[mapRoute]}
    />
  );
}
