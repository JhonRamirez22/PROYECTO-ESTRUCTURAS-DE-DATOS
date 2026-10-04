export type RoadGeometryProvider = "OSRM" | "ORS";

/** Solo se presenta una geometría como ruta vial si el proveedor está reconocido. */
export function isRoadGeometryProvider(value: unknown): value is RoadGeometryProvider {
  return value === "OSRM" || value === "ORS";
}
