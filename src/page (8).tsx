"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/AppShell";
import { isCourierLocationFresh } from "@/lib/courierLocation";

const CourierRouteMap = dynamic(() => import("./CourierRouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] items-center justify-center bg-slate-100 text-sm text-slate-500">
      Cargando mapa de tu ruta…
    </div>
  ),
});

const MIN_UPDATE_INTERVAL_MS = 5_000;
const NAVIGATION_REFRESH_INTERVAL_MS = 15_000;

interface LastLocation {
  lat: number;
  lng: number;
  recordedAt: string;
}

interface NavigationSnapshot {
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
  distanceMeters: number;
  durationMinutes: number;
  source: "osrm" | "ors";
  geometryProvider: "OSRM" | "ORS";
  nextDeliveryPointId: string;
  remainingDeliveryPointIds: string[];
  warning?: string;
}

interface AssignedRoute {
  id: string;
  status: "PLANNED" | "IN_PROGRESS";
  courier: {
    currentLat: number | null;
    currentLng: number | null;
  };
  geometryProvider: "OSRM" | "ORS" | null;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  } | null;
  deliveryPoints: Array<{
    id: string;
    address: string;
    lat: number;
    lng: number;
    sequenceIndex: number | null;
    status: "PENDING" | "EN_ROUTE" | "DELIVERED" | "FAILED";
  }>;
}

interface CourierProfile {
  status: "AVAILABLE" | "ON_ROUTE" | "OFFLINE";
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: string | null;
}

export default function RepartidorPage() {
  const [courierStatus, setCourierStatus] = useState<CourierProfile["status"]>("OFFLINE");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const [lastLocation, setLastLocation] = useState<LastLocation | null>(null);
  const [sentEvents, setSentEvents] = useState(0);
  const [assignedRoute, setAssignedRoute] = useState<AssignedRoute | null>(null);
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const activeDeliveryPoints =
    assignedRoute?.deliveryPoints.filter(
      (point) => point.status === "PENDING" || point.status === "EN_ROUTE",
    ) ?? [];

  const loadCourierProfile = useCallback(async (): Promise<void> => {
    setLoadingProfile(true);

    try {
      const response = await fetch("/api/repartidores/me", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo validar tu sesión."));
      }

      const payload = (await response.json()) as { courier: CourierProfile };
      setCourierStatus(payload.courier.status);
      setLastLocation(
        payload.courier.currentLat !== null &&
          payload.courier.currentLng !== null &&
          payload.courier.lastLocationAt
          ? {
              lat: payload.courier.currentLat,
              lng: payload.courier.currentLng,
              recordedAt: payload.courier.lastLocationAt,
            }
          : null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo validar tu sesión.",
      );
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const refreshNavigation = useCallback(async (routeId: string): Promise<void> => {
    const response = await fetch(`/api/rutas/${encodeURIComponent(routeId)}/navegacion`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "No se pudo actualizar la navegación."));
    }

    const payload = (await response.json()) as {
      navigation: NavigationSnapshot | null;
    };
    setNavigation(payload.navigation);
    setNavigationError(null);

    if (payload.navigation) {
      setAssignedRoute((currentRoute) =>
        currentRoute?.id === routeId
          ? {
              ...currentRoute,
              geometry: payload.navigation!.geometry,
              geometryProvider: payload.navigation!.geometryProvider,
            }
          : currentRoute,
      );
    }
  }, []);

  const loadAssignedRoute = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/rutas", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo cargar la ruta asignada."));
      }

      const payload = (await response.json()) as { routes: AssignedRoute[] };
      const route = payload.routes.find(
        (candidate) =>
          candidate.status === "PLANNED" || candidate.status === "IN_PROGRESS",
      ) ?? null;

      setAssignedRoute(route);
      setNavigation(null);

      if (route) {
        void refreshNavigation(route.id).catch((navigationError) => {
          setNavigationError(
            navigationError instanceof Error
              ? navigationError.message
              : "No se pudo actualizar la ruta vial; se conserva solo la geometría vial guardada.",
          );
        });
      } else {
        setNavigationError(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la ruta asignada. Recupera la conexión e inténtalo de nuevo.",
      );
    }
  }, [refreshNavigation]);

  useEffect(() => {
    // Retira identificadores y rutas privadas almacenados por versiones antiguas de la PWA.
    window.localStorage.removeItem("rutas-pasto:courier-id");
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("rutas-pasto:assigned-route:")) {
        window.localStorage.removeItem(key);
      }
    }
    void loadCourierProfile();
    void loadAssignedRoute();

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [loadAssignedRoute, loadCourierProfile]);

  useEffect(() => {
    const handleOnline = () => {
      void loadCourierProfile();
      void loadAssignedRoute();
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [loadAssignedRoute, loadCourierProfile]);

  useEffect(() => {
    if (!lastLocation) {
      return;
    }

    const expireStalePosition = () => {
      if (!isCourierLocationFresh(new Date(lastLocation.recordedAt))) {
        setLastLocation(null);
      }
    };
    const interval = window.setInterval(expireStalePosition, 15_000);
    return () => window.clearInterval(interval);
  }, [lastLocation]);

  useEffect(() => {
    const routeId = assignedRoute?.id;
    const shouldRefresh =
      routeId !== undefined &&
      (assignedRoute?.status === "IN_PROGRESS" || isTracking);

    if (!shouldRefresh || routeId === undefined) {
      return;
    }

    const refresh = () => {
      void refreshNavigation(routeId).catch(() => {
        // La última geometría válida permanece visible durante un fallo puntual.
      });
    };
    const interval = window.setInterval(refresh, NAVIGATION_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [assignedRoute?.id, assignedRoute?.status, isTracking, refreshNavigation]);

  const stopTracking = async () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setIsTracking(false);
    try {
      const response = await fetch("/api/repartidores/me/ubicacion", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo actualizar el estado."));
      }
      const payload = (await response.json()) as { courier: { status: CourierProfile["status"] } };
      setCourierStatus(payload.courier.status);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "El GPS se detuvo en el dispositivo, pero no se confirmó con el servidor.");
    }
  };

  const updateRouteStatus = async (status: "IN_PROGRESS" | "COMPLETED") => {
    if (!assignedRoute) {
      return;
    }

    try {
      const response = await fetch(`/api/rutas/${encodeURIComponent(assignedRoute.id)}`, {
        body: JSON.stringify({ status }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo actualizar la ruta."));
      }

      setError(null);
      await loadAssignedRoute();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar la ruta.");
    }
  };

  const updateDeliveryStatus = async (
    deliveryPointId: string,
    status: "DELIVERED" | "FAILED",
  ) => {
    try {
      const response = await fetch(`/api/pedidos/${encodeURIComponent(deliveryPointId)}`, {
        body: JSON.stringify({ status }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo actualizar la entrega."));
      }

      setError(null);
      await loadAssignedRoute();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar la entrega.");
    }
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setError("Este dispositivo no permite obtener la ubicación.");
      return;
    }

    setError(null);
    void loadAssignedRoute();
    setSentEvents(0);
    lastSentAt.current = 0;

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const recordedAt = new Date(position.timestamp).toISOString();
        const now = Date.now();

        if (now - lastSentAt.current < MIN_UPDATE_INTERVAL_MS) {
          return;
        }

        lastSentAt.current = now;
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          recordedAt,
        };

        void sendLocation(location).then((result) => {
          if (result.accepted) {
            setLastLocation(location);
            setCourierStatus(assignedRoute ? "ON_ROUTE" : "AVAILABLE");
            setSentEvents((current) => current + 1);
            setError(null);
          } else if (result.error) {
            setError(result.error);
          }
        });
      },
      (positionError) => {
        setError(formatGeolocationError(positionError));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 10_000,
      },
    );

    setIsTracking(true);
  };

  return (
    <AppShell active="courier">
      <main className="px-5 py-8 text-slate-950 sm:px-8">
      <section className="mx-auto max-w-xl">
        <h1 className="text-3xl font-semibold tracking-tight">Tu próxima entrega, clara y cerca</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Tu cuenta privada carga únicamente tus entregas. Activa el GPS al comenzar
          el turno para que el despacho pueda asignarte rutas dentro de Pasto.
        </p>

        <div className="mt-8 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Sesión del repartidor</p>
            <p className="mt-1 text-xs text-slate-500">
                {loadingProfile
                  ? "Verificando acceso…"
                  : formatCourierStatus(courierStatus, lastLocation !== null)}
              </p>
            </div>
            <span className={`h-2.5 w-2.5 rounded-full ${isTracking ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rp-button rp-button-primary disabled:cursor-not-allowed"
              disabled={isTracking || loadingProfile}
              onClick={startTracking}
              type="button"
            >
              Iniciar ubicación
            </button>
            <button
              className="rp-button rp-button-danger disabled:cursor-not-allowed"
              disabled={!isTracking}
              onClick={stopTracking}
              type="button"
            >
              Detener
            </button>
            <button
              className="rp-button rp-button-secondary disabled:cursor-not-allowed"
              disabled={loadingProfile}
              onClick={() => void loadAssignedRoute()}
              type="button"
            >
              Cargar ruta asignada
            </button>
            <button
              className="rp-button rp-button-quiet disabled:cursor-not-allowed"
              disabled={isTracking || loadingProfile}
              onClick={() => {
                void loadCourierProfile();
                void loadAssignedRoute();
              }}
              type="button"
            >
              Actualizar estado
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <StatusCard
            label="Estado"
            value={
              isTracking
                ? lastLocation
                  ? "GPS activo"
                  : "Buscando GPS"
                : formatCourierStatus(courierStatus, lastLocation !== null)
            }
            tone={isTracking ? "teal" : "slate"}
          />
          <StatusCard label="Eventos enviados" value={sentEvents.toString()} tone="blue" />
        </div>

        {lastLocation ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <p className="font-semibold text-slate-800">Última posición enviada</p>
            <p className="mt-2 font-mono text-xs text-slate-500">
              {lastLocation.lat.toFixed(6)}, {lastLocation.lng.toFixed(6)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {new Date(lastLocation.recordedAt).toLocaleString("es-CO")}
            </p>
          </div>
        ) : null}

        {assignedRoute ? (
          <section className="mt-4 rounded-2xl border border-teal-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">Ruta asignada</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {assignedRoute.id.slice(0, 8)} · {activeDeliveryPoints.length} pendientes
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700">
                  {assignedRoute.status === "IN_PROGRESS" ? "En curso" : "Planeada"}
                </span>
                {assignedRoute.status === "PLANNED" ? (
                  <button
                    className="rp-button rp-button-primary rp-button-small"
                    onClick={() => void updateRouteStatus("IN_PROGRESS")}
                    type="button"
                  >
                    Iniciar ruta
                  </button>
                ) : null}
                {assignedRoute.status === "IN_PROGRESS" ? (
                  <button
                    className="rp-button rp-button-quiet rp-button-small"
                    onClick={() => void updateRouteStatus("COMPLETED")}
                    type="button"
                  >
                    Cerrar ruta
                  </button>
                ) : null}
              </div>
            </div>
            <CourierRouteMap currentLocation={lastLocation} route={assignedRoute} />
            {navigationError ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" role="status">
                {navigationError}
              </p>
            ) : null}
            {navigation ? (
              <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                      Navegación activa
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      Próxima parada: {activeDeliveryPoints.find(
                        (point) => point.id === navigation.nextDeliveryPointId,
                      )?.address ?? "pendiente"}
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-sky-700">
                    Calles {navigation.geometryProvider}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-white px-3 py-2">
                    <span className="text-slate-400">Distancia restante</span>
                    <strong className="mt-1 block text-slate-700">
                      {formatDistance(navigation.distanceMeters)}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2">
                    <span className="text-slate-400">Tiempo estimado</span>
                    <strong className="mt-1 block text-slate-700">
                      {Math.max(1, Math.round(navigation.durationMinutes))} min
                    </strong>
                  </div>
                </div>
                {navigation.warning ? (
                  <p className="mt-2 text-[11px] leading-4 text-amber-700">
                    {navigation.warning}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] leading-4 text-sky-700">
                    El trazado sigue calles de OpenStreetMap mediante {navigation.geometryProvider}. El proveedor público no ofrece tráfico en tiempo real.
                  </p>
                )}
              </div>
            ) : null}
            <ol className="mt-3 space-y-2 text-sm text-slate-600">
              {activeDeliveryPoints.length === 0 ? (
                <li className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  No tienes entregas pendientes en esta ruta.
                </li>
              ) : activeDeliveryPoints.map((point, index) => (
                <li key={point.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex min-w-0 gap-2">
                    <span className="font-semibold text-teal-700">
                      {(point.sequenceIndex ?? index) + 1}.
                    </span>
                    <span>
                      <span className="block">{point.address}</span>
                      <span className="text-[11px] text-slate-400">{formatDeliveryStatus(point.status)}</span>
                    </span>
                  </div>
                  {assignedRoute.status === "IN_PROGRESS" &&
                  (point.status === "PENDING" || point.status === "EN_ROUTE") ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rp-button rp-button-small border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100"
                        onClick={() => void updateDeliveryStatus(point.id, "DELIVERED")}
                        type="button"
                      >
                        Entregada
                      </button>
                      <button
                        className="rp-button rp-button-danger rp-button-small px-2 py-1"
                        onClick={() => void updateDeliveryStatus(point.id, "FAILED")}
                        type="button"
                      >
                        Fallida
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!assignedRoute && !loadingProfile && !error ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm leading-6 text-slate-500 shadow-sm">
            {loadingProfile ? "Cargando tus entregas…" : "El despacho todavía no te ha asignado una ruta."}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
      </section>
      </main>
    </AppShell>
  );
}

async function sendLocation(
  location: LastLocation,
): Promise<{ accepted: boolean; error?: string }> {
  try {
    const response = await fetch("/api/repartidores/me/ubicacion", {
      body: JSON.stringify(location),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      return {
        accepted: false,
        error: await readApiError(response, "El servidor rechazó la ubicación."),
      };
    }

    const payload = (await response.json()) as { accepted: boolean };
    return payload.accepted
      ? { accepted: true }
      : { accepted: false, error: "Se ignoró una posición más antigua que la última recibida." };
  } catch (error) {
    // La siguiente lectura de geolocalización volverá a intentar sincronizar la posición.
    return {
      accepted: false,
      error: error instanceof Error ? error.message : "No se pudo enviar la ubicación.",
    };
  }
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function formatDeliveryStatus(status: AssignedRoute["deliveryPoints"][number]["status"]): string {
  switch (status) {
    case "DELIVERED":
      return "Entregada";
    case "FAILED":
      return "Fallida";
    case "EN_ROUTE":
      return "En camino";
    default:
      return "Pendiente";
  }
}

function formatDistance(distanceMeters: number): string {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
}

function formatCourierStatus(
  status: CourierProfile["status"],
  hasFreshPosition: boolean,
): string {
  if (status !== "OFFLINE" && !hasFreshPosition) {
    return "GPS vencido · no disponible para asignación";
  }

  switch (status) {
    case "AVAILABLE":
      return "Disponible · GPS reciente";
    case "ON_ROUTE":
      return "En ruta";
    default:
      return "Fuera de turno";
  }
}

function formatGeolocationError(error: GeolocationPositionError): string {
  if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
    return "Permite el acceso a la ubicación para iniciar el seguimiento.";
  }

  if (error.code === GeolocationPositionError.TIMEOUT) {
    return "El dispositivo tardó demasiado en obtener la ubicación.";
  }

  return "No se pudo obtener la ubicación actual. Intenta moverte a un lugar con mejor señal.";
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "slate" | "teal";
}) {
  const toneClasses = {
    blue: "bg-blue-50 text-blue-700",
    slate: "bg-slate-100 text-slate-700",
    teal: "bg-teal-50 text-teal-700",
  } as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 inline-flex rounded-lg px-2.5 py-1 text-sm font-semibold ${toneClasses[tone]}`}>
        {value}
      </p>
    </div>
  );
}
