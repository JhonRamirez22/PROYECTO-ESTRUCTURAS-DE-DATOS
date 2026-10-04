"use client";

import { layersFactory } from "@maplibre/maplibre-gl-directions";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  isWithinPastoServiceArea,
  PASTO_SERVICE_BOUNDS,
} from "@/lib/pastoArea";
import { getPastoMapCenter } from "@/lib/mapCenter";
import { isRoadGeometryProvider } from "@/lib/roadGeometry";
import { isMapStyleAuthorizationError } from "./mapStyleFallback";

export interface MapCourier {
  id: string;
  name: string;
  currentLat: number | null;
  currentLng: number | null;
}

export interface MapDeliveryPoint {
  id: string;
  address: string;
  lat: number;
  lng: number;
  sequenceIndex: number | null;
  status?: "PENDING" | "EN_ROUTE" | "DELIVERED" | "FAILED";
}

export interface MapRoute {
  id: string;
  courier: MapCourier;
  deliveryPoints: MapDeliveryPoint[];
  geometryProvider?: "OSRM" | "ORS" | null;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  } | null;
}

interface MapLibreRouteMapProps {
  couriers: MapCourier[];
  routes: MapRoute[];
  pendingPoints?: MapDeliveryPoint[];
  selectedCoordinate?: [number, number] | null;
  onMapClick?: (coordinate: { lat: number; lng: number }) => void;
  className?: string;
  ariaLabel?: string;
}

type MapStatus = "loading" | "slow" | "unavailable" | "ready";

interface MapProperties {
  color?: string;
  label?: string;
  route?: "SELECTED" | "ALT";
  congestion?: number;
  profile?: "driving";
}

type MapFeature = GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, MapProperties>;
type MapFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.LineString,
  MapProperties
>;

const PASTO_CENTER = getPastoMapCenter(
  process.env.NEXT_PUBLIC_MAP_DEFAULT_LAT,
  process.env.NEXT_PUBLIC_MAP_DEFAULT_LNG,
);
const PASTO_MAP_BOUNDS: [[number, number], [number, number]] = [
  [PASTO_SERVICE_BOUNDS.minLongitude, PASTO_SERVICE_BOUNDS.minLatitude],
  [PASTO_SERVICE_BOUNDS.maxLongitude, PASTO_SERVICE_BOUNDS.maxLatitude],
];
const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();

// Fiord conserva el ambiente oscuro, pero mejora la lectura de calles y
// etiquetas frente al preset dark. OpenFreeMap no exige una API key.
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
// El fallback usa teselas oscuras para que una caída del estilo vectorial no
// cambie bruscamente la lectura operativa del mapa ni oculte las rutas verdes.
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    cartoDark: {
      type: "raster",
      tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster",
      source: "cartoDark",
      paint: {
        "raster-saturation": -0.1,
        "raster-contrast": 0.08,
      },
    },
  ],
};

export default function MapLibreRouteMap({
  ariaLabel = "Mapa de rutas",
  className = "h-[min(68vh,680px)] min-h-[400px] w-full",
  couriers,
  onMapClick,
  pendingPoints = [],
  routes,
  selectedCoordinate = null,
}: MapLibreRouteMapProps) {
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const retryMapRef = useRef<(() => void) | null>(null);
  const dataRef = useRef({ couriers, pendingPoints, routes, selectedCoordinate });
  dataRef.current = { couriers, pendingPoints, routes, selectedCoordinate };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL || DEFAULT_STYLE_URL,
      center: PASTO_CENTER,
      zoom: 13,
      maxBounds: PASTO_MAP_BOUNDS,
      minZoom: 11,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    let fallbackApplied = false;
    let fallbackTimer = 0;
    const slowTimer = window.setTimeout(() => setMapStatus("slow"), 7000);
    const unavailableTimer = window.setTimeout(() => setMapStatus("unavailable"), 20000);
    const markMapReady = () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(unavailableTimer);
      setMapStatus("ready");
    };
    const renderData = () => {
      addMapLayers(map);
      updateMapData(map, dataRef.current);
      map.once("idle", markMapReady);
    };
    const applyFallbackStyle = () => {
      if (fallbackApplied) {
        return;
      }

      fallbackApplied = true;
      window.clearTimeout(fallbackTimer);
      map.setStyle(FALLBACK_STYLE);
      map.once("style.load", renderData);
    };
    retryMapRef.current = () => {
      window.clearTimeout(fallbackTimer);
      setMapStatus("loading");
      fallbackApplied = false;
      map.once("style.load", renderData);
      map.setStyle(MAP_STYLE_URL || DEFAULT_STYLE_URL);
      fallbackTimer = window.setTimeout(() => {
        if (!map.isStyleLoaded() && !fallbackApplied) {
          applyFallbackStyle();
        }
      }, 5000);
    };
    const handleMapError = (event: unknown) => {
      if (isMapStyleAuthorizationError(event)) {
        applyFallbackStyle();
      }
    };
    map.on("error", handleMapError);
    fallbackTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded() && !fallbackApplied) {
        applyFallbackStyle();
      }
    }, 5000);

    map.once("load", renderData);
    const resizeTimer = window.setTimeout(() => map.resize(), 0);

    return () => {
      window.clearTimeout(resizeTimer);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(slowTimer);
      window.clearTimeout(unavailableTimer);
      map.off("error", handleMapError);
      map.remove();
      mapRef.current = null;
      retryMapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      return;
    }

    updateMapData(map, { couriers, pendingPoints, routes, selectedCoordinate });
  }, [couriers, pendingPoints, routes, selectedCoordinate]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !onMapClick) {
      return;
    }

    const handleMapClick = (event: maplibregl.MapMouseEvent) => {
      if (!isWithinPastoServiceArea(event.lngLat.lat, event.lngLat.lng)) {
        return;
      }
      onMapClick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [onMapClick]);

  return (
    <div
      aria-label={ariaLabel}
      className={`relative isolate overflow-hidden bg-[#17242b] ${className}`}
      role="region"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        style={{ height: "100%", width: "100%" }}
      />
      {mapStatus !== "ready" ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#0b1518]/35 px-4 text-center backdrop-blur-[2px]"
          role="status"
        >
          <div className="max-w-sm rounded-2xl border border-white/15 bg-[#142422]/95 px-5 py-4 text-white shadow-[0_14px_36px_rgba(0,0,0,0.32)]">
            <div className="flex items-center justify-center gap-3">
              {mapStatus !== "unavailable" ? (
                <span
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-emerald-100/35 border-t-emerald-300 motion-reduce:animate-none"
                />
              ) : null}
              <p className="text-sm font-semibold text-emerald-50">
                {mapStatus === "loading"
                  ? "Cargando calles de Pasto…"
                  : mapStatus === "slow"
                    ? "El mapa está tardando en responder…"
                    : "No se pudieron cargar las calles."}
              </p>
            </div>
            {mapStatus === "unavailable" ? (
              <>
                <p className="mt-2 text-xs leading-5 text-white/75">
                  Revisa tu conexión e inténtalo de nuevo.
                </p>
                <button
                  className="rp-button rp-button-secondary rp-button-small pointer-events-auto mt-3"
                  onClick={() => retryMapRef.current?.()}
                  type="button"
                >
                  Reintentar mapa
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function addMapLayers(map: MapLibreMap): void {
  if (!map.getSource("delivery-directions")) {
    map.addSource("delivery-directions", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });

    // Capas oficiales del plugin: casing, rutas alternativas, ruta seleccionada
    // y colores de congestión de verde a rojo.
    for (const layer of layersFactory(1.2, 1.25, "delivery-directions")) {
      map.addLayer(layer);
    }

    // Línea operativa superior: garantiza que el trayecto seleccionado siga
    // siendo visible aunque todavía no exista un factor de tráfico histórico.
    map.addLayer({
      id: "delivery-route-highlight-casing",
      type: "line",
      source: "delivery-directions",
      filter: ["==", ["get", "route"], "SELECTED"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#06130b",
        "line-opacity": 0.95,
        "line-width": 10,
      },
    });
    map.addLayer({
      id: "delivery-route-highlight",
      type: "line",
      source: "delivery-directions",
      filter: ["==", ["get", "route"], "SELECTED"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#55f26b",
        "line-opacity": 1,
        "line-width": 5.5,
        "line-blur": 0.15,
      },
    });
  }

  if (!map.getSource("delivery-labels")) {
    map.addSource("delivery-labels", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
    map.addLayer({
      id: "delivery-labels",
      type: "symbol",
      source: "delivery-labels",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "#111827",
        "text-halo-width": 2,
      },
    });
  }

  if (!map.getSource("courier-points")) {
    map.addSource("courier-points", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
    map.addLayer({
      id: "courier-points",
      type: "circle",
      source: "courier-points",
      paint: {
        "circle-color": "#06b6d4",
        "circle-radius": 10,
        "circle-stroke-color": "#ecfeff",
        "circle-stroke-width": 3,
      },
    });
    map.addLayer({
      id: "courier-labels",
      type: "symbol",
      source: "courier-points",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, 1.6],
        "text-anchor": "top",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ecfeff",
        "text-halo-color": "#0f172a",
        "text-halo-width": 2,
      },
    });
  }

  if (!map.getSource("delivery-points")) {
    map.addSource("delivery-points", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
    map.addLayer({
      id: "delivery-points",
      type: "circle",
      source: "delivery-points",
      paint: {
        "circle-color": ["coalesce", ["get", "color"], "#a855f7"],
        "circle-radius": 8,
        "circle-stroke-color": "#f5d0fe",
        "circle-stroke-width": 3,
      },
    });
  }
}

function updateMapData(
  map: MapLibreMap,
  data: {
    couriers: MapCourier[];
    pendingPoints: MapDeliveryPoint[];
    routes: MapRoute[];
    selectedCoordinate: [number, number] | null;
  },
): void {
  const directionFeatures: MapFeature[] = [];
  const labelFeatures: MapFeature[] = [];
  const courierFeatures: MapFeature[] = [];
  const deliveryFeatures: MapFeature[] = [];
  const focusCoordinates: Array<[number, number]> = [];

  for (const courier of data.couriers) {
    if (courier.currentLat === null || courier.currentLng === null) {
      continue;
    }

    const coordinate: [number, number] = [courier.currentLng, courier.currentLat];
    focusCoordinates.push(coordinate);
    courierFeatures.push(pointFeature(coordinate, "#06b6d4", courier.name));
    labelFeatures.push(pointFeature(coordinate, "#06b6d4", courier.name));
  }

  for (const [routeIndex, route] of data.routes.entries()) {
    const currentCourier =
      data.couriers.find((courier) => courier.id === route.courier.id) ?? route.courier;

    if (currentCourier.currentLat !== null && currentCourier.currentLng !== null) {
      focusCoordinates.push([currentCourier.currentLng, currentCourier.currentLat]);
    }
    // No dibujamos datos históricos fuera de Pasto: evita que un registro
    // antiguo con coordenadas 0,0 cambie el encuadre hacia otro país.
    const validRoutePoints = route.deliveryPoints.filter((point) =>
      isWithinPastoServiceArea(point.lat, point.lng),
    );
    const geometryCoordinates = route.geometry?.coordinates;
    const hasValidGeometry =
      isRoadGeometryProvider(route.geometryProvider) &&
      geometryCoordinates !== undefined &&
      geometryCoordinates.length > 1 &&
      geometryCoordinates.every(([lng, lat]) =>
        isWithinPastoServiceArea(lat, lng),
      );
    // Sin geometría vial de OSRM no dibujamos conexiones rectas que aparenten
    // ser calles: los marcadores siguen visibles y la navegación puede reintentarse.
    if (hasValidGeometry && geometryCoordinates) {
      directionFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: geometryCoordinates },
        properties: {
          route: routeIndex === 0 ? "SELECTED" : "ALT",
          // OSRM público no entrega tráfico en tiempo real; 1 representa una
          // ruta libre y deja la capa lista para un factor histórico futuro.
          congestion: 1,
          profile: "driving",
        },
      });
    }

    for (const [index, point] of validRoutePoints.entries()) {
      const coordinate: [number, number] = [point.lng, point.lat];
      focusCoordinates.push(coordinate);
      const label = `${(point.sequenceIndex ?? index) + 1}`;
      const color = deliveryPointColor(point.status);
      deliveryFeatures.push(pointFeature(coordinate, color, label));
      labelFeatures.push(pointFeature(coordinate, color, label));
    }
  }

  for (const point of data.pendingPoints) {
    if (!isWithinPastoServiceArea(point.lat, point.lng)) {
      continue;
    }
    const coordinate: [number, number] = [point.lng, point.lat];
    focusCoordinates.push(coordinate);
    deliveryFeatures.push(pointFeature(coordinate, "#f59e0b", "Pendiente"));
    labelFeatures.push(pointFeature(coordinate, "#f59e0b", "Pendiente"));
  }

  if (data.selectedCoordinate) {
    const coordinate: [number, number] = [data.selectedCoordinate[1], data.selectedCoordinate[0]];
    focusCoordinates.push(coordinate);
    deliveryFeatures.push(pointFeature(coordinate, "#facc15", "Nueva ubicación"));
    labelFeatures.push(pointFeature(coordinate, "#facc15", "Nueva ubicación"));
  }

  const directionsSource = map.getSource("delivery-directions") as GeoJSONSource | undefined;
  const labelsSource = map.getSource("delivery-labels") as GeoJSONSource | undefined;
  const couriersSource = map.getSource("courier-points") as GeoJSONSource | undefined;
  const deliveriesSource = map.getSource("delivery-points") as GeoJSONSource | undefined;
  directionsSource?.setData(featureCollection(directionFeatures));
  labelsSource?.setData(featureCollection(labelFeatures));
  couriersSource?.setData(featureCollection(courierFeatures));
  deliveriesSource?.setData(featureCollection(deliveryFeatures));

  if (focusCoordinates.length === 1) {
    map.setCenter(focusCoordinates[0]!);
    map.setZoom(16);
  } else if (focusCoordinates.length > 1) {
    const bounds = new maplibregl.LngLatBounds(focusCoordinates[0], focusCoordinates[0]);

    for (const coordinate of focusCoordinates.slice(1)) {
      bounds.extend(coordinate);
    }

    map.fitBounds(bounds, { maxZoom: 16, padding: 36, duration: 500 });
  }
}

function pointFeature(
  coordinate: [number, number],
  color: string,
  label: string,
): MapFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coordinate },
    properties: { color, label },
  };
}

function deliveryPointColor(status: MapDeliveryPoint["status"]): string {
  switch (status) {
    case "DELIVERED":
      return "#22c55e";
    case "FAILED":
      return "#f43f5e";
    case "EN_ROUTE":
      return "#38bdf8";
    default:
      return "#a855f7";
  }
}

function emptyFeatureCollection(): MapFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function featureCollection(features: MapFeature[]): MapFeatureCollection {
  return { type: "FeatureCollection", features };
}
