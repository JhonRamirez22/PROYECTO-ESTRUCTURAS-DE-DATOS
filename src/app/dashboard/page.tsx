'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import { isCourierLocationFresh } from '@/lib/courierLocation';
import { isRoadGeometryProvider } from '@/lib/roadGeometry';
import { formatNotificationMessage, formatOrderReference } from '@/lib/formatOrderReference';
import CustomerNotificationReadiness, {
  isCustomerNotificationOperationsStatus,
  type CustomerNotificationOperationsStatus,
} from '@/components/CustomerNotificationReadiness';
import RoutingMethodology from '@/components/RoutingMethodology';

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[min(68vh,680px)] min-h-[400px] items-center justify-center bg-[#17242b] text-sm text-slate-300">
      Cargando mapa de Pasto…
    </div>
  ),
});

type CourierStatus = 'AVAILABLE' | 'ON_ROUTE' | 'OFFLINE';

interface Courier {
  id: string;
  name: string;
  phone: string;
  status: CourierStatus;
  currentLat: number | null;
  currentLng: number | null;
  lastLocationAt: string | null;
}

interface DeliveryPoint {
  id: string;
  orderId: string;
  address: string;
  lat: number;
  lng: number;
  status: 'PENDING' | 'EN_ROUTE' | 'DELIVERED' | 'FAILED';
  sequenceIndex: number | null;
}

interface Route {
  id: string;
  courierId: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  estimatedDurationMinutes: number;
  estimatedDistanceMeters: number;
  canUndo: boolean;
  geometry: {
    type: 'LineString';
    coordinates: Array<[number, number]>;
  } | null;
  geometryProvider: 'OSRM' | 'ORS' | null;
  courier: Courier;
  deliveryPoints: DeliveryPoint[];
}

interface DashboardData {
  couriers: Courier[];
  notifications: Notification[];
  notificationsWarning: string | null;
  pendingPoints: DeliveryPoint[];
  routes: Route[];
  metrics: FleetMetrics;
}

interface FleetMetrics {
  routeCount: number;
  completedRouteCount: number;
  estimatedDurationMinutes: number;
  estimatedDistanceMeters: number;
  timeSavedMinutes: number;
  distanceSavedMeters: number;
  routesWithBaseline: number;
}

interface AssignmentAiStatus {
  source: 'external-ai' | 'deterministic' | 'tomtom-live';
  applied: boolean;
  model?: string;
  warning?: string;
}

interface LiveTrafficStatus {
  source: string;
  configured: boolean;
  applied: boolean;
  routeSegments: number;
  sampledSegments: number;
  adjustedSegments: number;
  closedSegments: number;
  coverageRatio: number;
  warning: string;
}

interface CustomerNotificationSummary {
  queued: number;
  channels: {
    email: { queued: number; configured: boolean };
    sms: { queued: number; configured: boolean };
  };
  warning?: string | null;
}

const ROUTE_STATUS_PRIORITY: Record<Route['status'], number> = {
  IN_PROGRESS: 0,
  PLANNED: 1,
  COMPLETED: 2,
  CANCELLED: 3,
};

interface Notification {
  id: string;
  kind:
    | 'DELIVERY_STATUS_CHANGED'
    | 'ROUTE_CREATED'
    | 'ROUTE_RECALCULATED'
    | 'ROUTE_RECALCULATION_FAILED';
  title: string;
  message: string;
  createdAt: string;
}

interface AssignmentProposal {
  courierId: string;
  deliveryPointIds: string[];
}

interface IssuedCourierCode {
  courierName: string;
  accessCode: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({
    couriers: [],
    notifications: [],
    notificationsWarning: null,
    pendingPoints: [],
    routes: [],
    metrics: {
      routeCount: 0,
      completedRouteCount: 0,
      estimatedDurationMinutes: 0,
      estimatedDistanceMeters: 0,
      timeSavedMinutes: 0,
      distanceSavedMeters: 0,
      routesWithBaseline: 0,
    },
  });
  const [loading, setLoading] = useState(true);
  const [creatingCourier, setCreatingCourier] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [recalculatingRouteId, setRecalculatingRouteId] = useState<string | null>(null);
  const [undoingRouteId, setUndoingRouteId] = useState<string | null>(null);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [selectedCourierIds, setSelectedCourierIds] = useState<string[]>([]);
  const [assignmentPreview, setAssignmentPreview] = useState<AssignmentProposal[]>([]);
  const [unassignedDeliveryPointIds, setUnassignedDeliveryPointIds] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [courierDraft, setCourierDraft] = useState({ name: '', phone: '' });
  const [issuedCourierCode, setIssuedCourierCode] = useState<IssuedCourierCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeActionNotice, setRouteActionNotice] = useState<string | null>(null);
  const [assignmentAiStatus, setAssignmentAiStatus] = useState<AssignmentAiStatus | null>(null);
  const [liveTrafficNotice, setLiveTrafficNotice] = useState<string | null>(null);
  const [customerNotificationSummary, setCustomerNotificationSummary] =
    useState<CustomerNotificationSummary | null>(null);
  const [customerNotificationOperationsStatus, setCustomerNotificationOperationsStatus] =
    useState<CustomerNotificationOperationsStatus | null>(null);
  const [customerNotificationOperationsUnavailable, setCustomerNotificationOperationsUnavailable] =
    useState(false);
  const dashboardRequestId = useRef(0);

  const loadDashboard = useCallback(async () => {
    const requestId = ++dashboardRequestId.current;
    setLoading(true);
    setError(null);

    try {
      const [
        couriersResponse,
        notificationsResponse,
        ordersResponse,
        routesResponse,
        analyticsResponse,
        customerNotificationStatusResponse,
      ] = await Promise.all([
        fetch('/api/repartidores', { cache: 'no-store' }),
        fetch('/api/notificaciones?recipientId=dispatcher&limit=5', {
          cache: 'no-store',
        }),
        fetch('/api/pedidos?status=PENDING', { cache: 'no-store' }),
        fetch('/api/rutas', { cache: 'no-store' }),
        fetch('/api/analitica', { cache: 'no-store' }),
        fetch('/api/notificaciones/clientes/estado', { cache: 'no-store' }).catch(() => null),
      ]);

      if (
        !couriersResponse.ok ||
        !routesResponse.ok ||
        !ordersResponse.ok ||
        !notificationsResponse.ok ||
        !analyticsResponse.ok
      ) {
        throw new Error('No se pudieron cargar los datos operativos.');
      }

      const couriersPayload = (await couriersResponse.json()) as {
        couriers: Courier[];
      };
      const routesPayload = (await routesResponse.json()) as {
        routes: Route[];
      };
      const ordersPayload = (await ordersResponse.json()) as {
        deliveryPoints: DeliveryPoint[];
      };
      const notificationsPayload = (await notificationsResponse.json()) as {
        notifications: Notification[];
        warning?: string;
      };
      const analyticsPayload = (await analyticsResponse.json()) as {
        metrics: FleetMetrics;
      };
      let customerNotificationStatusPayload: unknown = null;
      if (customerNotificationStatusResponse?.ok) {
        try {
          customerNotificationStatusPayload = await customerNotificationStatusResponse.json();
        } catch {
          customerNotificationStatusPayload = null;
        }
      }

      if (requestId !== dashboardRequestId.current) return;

      if (isCustomerNotificationOperationsStatus(customerNotificationStatusPayload)) {
        setCustomerNotificationOperationsStatus(customerNotificationStatusPayload);
        setCustomerNotificationOperationsUnavailable(false);
      } else {
        setCustomerNotificationOperationsUnavailable(true);
      }

      setData({
        couriers: couriersPayload.couriers,
        notifications: notificationsPayload.notifications,
        notificationsWarning: notificationsPayload.warning ?? null,
        pendingPoints: ordersPayload.deliveryPoints,
        routes: routesPayload.routes,
        metrics: analyticsPayload.metrics,
      });
      setLastUpdatedAt(new Date());
    } catch (loadError) {
      if (requestId !== dashboardRequestId.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Error desconocido.');
    } finally {
      if (requestId === dashboardRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const availableCourierIds = data.couriers
      .filter(
        (courier) =>
          courier.status === 'AVAILABLE' &&
          courier.currentLat !== null &&
          courier.currentLng !== null &&
          isCourierLocationFresh(courier.lastLocationAt ? new Date(courier.lastLocationAt) : null)
      )
      .map((courier) => courier.id);

    setSelectedCourierIds((current) => {
      const valid = current.filter((id) => availableCourierIds.includes(id));
      return valid.length > 0 ? valid : availableCourierIds.slice(0, 1);
    });
  }, [data.couriers]);

  useEffect(() => {
    setSelectedPendingIds((current) => {
      const valid = current.filter((id) => data.pendingPoints.some((point) => point.id === id));
      return valid.length > 0 || data.pendingPoints.length === 0
        ? valid
        : data.pendingPoints.map((point) => point.id);
    });
  }, [data.pendingPoints]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const refreshInterval = window.setInterval(() => {
      void loadDashboard();
    }, 10_000);

    return () => window.clearInterval(refreshInterval);
  }, [loadDashboard]);

  const routesByOperationalPriority = [...data.routes].sort(
    (left, right) => ROUTE_STATUS_PRIORITY[left.status] - ROUTE_STATUS_PRIORITY[right.status]
  );
  const activeRoutes = routesByOperationalPriority.filter(
    (route) => route.status === 'PLANNED' || route.status === 'IN_PROGRESS'
  );
  const historicalRoutes = routesByOperationalPriority.filter(
    (route) => route.status === 'COMPLETED' || route.status === 'CANCELLED'
  );
  const pendingStops = activeRoutes.reduce(
    (total, route) =>
      total +
      route.deliveryPoints.filter(
        (point) => point.status === 'PENDING' || point.status === 'EN_ROUTE'
      ).length,
    0
  );

  const updateRouteStatus = async (
    routeId: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  ): Promise<void> => {
    try {
      const response = await fetch(`/api/rutas/${encodeURIComponent(routeId)}`, {
        body: JSON.stringify({ status }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: unknown };
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'No se pudo actualizar la ruta.'
        );
      }

      await loadDashboard();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : 'No se pudo actualizar la ruta.'
      );
    }
  };

  const recalculateRouteGeometry = async (routeId: string): Promise<void> => {
    setRecalculatingRouteId(routeId);
    setError(null);

    try {
      const response = await fetch(`/api/rutas/${encodeURIComponent(routeId)}/recalcular`, {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo recalcular el trazado vial.'));
      }

      const result = (await response.json()) as { liveTraffic?: LiveTrafficStatus };
      if (result.liveTraffic) {
        setLiveTrafficNotice(summarizeLiveTraffic([result.liveTraffic]));
      }
      await loadDashboard();
    } catch (recalculationError) {
      setError(
        recalculationError instanceof Error
          ? recalculationError.message
          : 'No se pudo recalcular el trazado vial.'
      );
    } finally {
      setRecalculatingRouteId(null);
    }
  };

  const undoRouteRecalculation = async (routeId: string): Promise<void> => {
    setUndoingRouteId(routeId);
    setError(null);
    setRouteActionNotice(null);

    try {
      const response = await fetch(
        `/api/rutas/${encodeURIComponent(routeId)}/deshacer-recalculo`,
        { method: 'POST' }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo restaurar la ruta anterior.'));
      }

      const result = (await response.json()) as { releasedDeliveryPointIds?: unknown };
      const releasedCount = Array.isArray(result.releasedDeliveryPointIds)
        ? result.releasedDeliveryPointIds.length
        : 0;
      setRouteActionNotice(
        releasedCount > 0
          ? `Se restauró la ruta anterior y ${releasedCount} parada${releasedCount === 1 ? ' volvió' : 's volvieron'} a pedidos pendientes.`
          : 'Se restauró el recálculo anterior de la ruta.'
      );
      await loadDashboard();
    } catch (undoError) {
      setError(
        undoError instanceof Error ? undoError.message : 'No se pudo restaurar la ruta anterior.'
      );
    } finally {
      setUndoingRouteId(null);
    }
  };

  const analyzeAssignments = async (): Promise<void> => {
    if (selectedCourierIds.length === 0) {
      setError('Selecciona al menos un repartidor disponible.');
      return;
    }

    if (selectedPendingIds.length === 0) {
      setError('Selecciona al menos un pedido pendiente.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setLiveTrafficNotice(null);
    setAssignmentPreview([]);
    setUnassignedDeliveryPointIds([]);

    try {
      const assignmentResponse = await fetch('/api/asignaciones', {
        body: JSON.stringify({
          courierIds: selectedCourierIds,
          deliveryPointIds: selectedPendingIds,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!assignmentResponse.ok) {
        throw new Error(await readApiError(assignmentResponse, 'No se pudo asignar el pedido.'));
      }

      const assignmentPayload = (await assignmentResponse.json()) as {
        assignments: Array<{ courierId: string; deliveryPointIds: string[] }>;
        unassignedDeliveryPointIds?: string[];
        ai?: AssignmentAiStatus;
      };
      setAssignmentAiStatus(assignmentPayload.ai ?? null);
      const unassignedIds = assignmentPayload.unassignedDeliveryPointIds ?? [];
      setUnassignedDeliveryPointIds(unassignedIds);
      const assignments = assignmentPayload.assignments.filter(
        (assignment) => assignment.deliveryPointIds.length > 0
      );

      if (assignments.length === 0 && unassignedIds.length === 0) {
        throw new Error('No hay pedidos asignables para ese repartidor.');
      }

      setAssignmentPreview(assignments);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : 'No se pudo analizar la asignación.'
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const dispatchAssignments = async (): Promise<void> => {
    if (assignmentPreview.length === 0) {
      setError('Primero analiza una asignación para generar la propuesta de ruta.');
      return;
    }

    setDispatching(true);
    setError(null);
    setCustomerNotificationSummary(null);

    try {
      const routeResponse = await fetch('/api/asignaciones/aplicar', {
        body: JSON.stringify({ assignments: assignmentPreview }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!routeResponse.ok) {
        throw new Error(await readApiError(routeResponse, 'No se pudo optimizar la ruta.'));
      }

      const routePayload = (await routeResponse.json()) as {
        routes?: Array<{
          trafficAi?: AssignmentAiStatus;
          liveTraffic?: LiveTrafficStatus;
        }>;
        customerNotifications?: unknown;
      };
      const trafficSummaries = (routePayload.routes ?? [])
        .map((route) => route.liveTraffic)
        .filter((status): status is LiveTrafficStatus => status !== undefined);
      if (trafficSummaries.length > 0) {
        setLiveTrafficNotice(summarizeLiveTraffic(trafficSummaries));
      }
      setCustomerNotificationSummary(
        isCustomerNotificationSummary(routePayload.customerNotifications)
          ? routePayload.customerNotifications
          : null
      );
      const routeAiStatus = routePayload.routes?.find(
        (route) => route.trafficAi !== undefined
      )?.trafficAi;
      if (routeAiStatus !== undefined) {
        setAssignmentAiStatus(routeAiStatus);
      }

      setAssignmentPreview([]);
      setUnassignedDeliveryPointIds([]);
      setSelectedPendingIds([]);
      await loadDashboard();
    } catch (dispatchError) {
      setError(
        dispatchError instanceof Error ? dispatchError.message : 'No se pudo despachar la ruta.'
      );
    } finally {
      setDispatching(false);
    }
  };

  const createCourier = async (): Promise<void> => {
    if (courierDraft.name.trim() === '' || courierDraft.phone.trim() === '') {
      setError('Completa el nombre y el teléfono del repartidor.');
      return;
    }

    setCreatingCourier(true);
    setError(null);

    try {
      const response = await fetch('/api/repartidores', {
        body: JSON.stringify({
          name: courierDraft.name.trim(),
          phone: courierDraft.phone.trim(),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo registrar el repartidor.'));
      }

      const payload = (await response.json()) as {
        courier: { name: string };
        accessCode: string;
      };
      setIssuedCourierCode({
        courierName: payload.courier.name,
        accessCode: payload.accessCode,
      });
      setCourierDraft({ name: '', phone: '' });
      await loadDashboard();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : 'No se pudo registrar el repartidor.'
      );
    } finally {
      setCreatingCourier(false);
    }
  };

  const rotateCourierAccessCode = async (courier: Courier): Promise<void> => {
    setError(null);
    try {
      const response = await fetch(`/api/repartidores/${encodeURIComponent(courier.id)}/codigo`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'No se pudo emitir el código.'));
      }
      const payload = (await response.json()) as { accessCode: string };
      setIssuedCourierCode({ courierName: courier.name, accessCode: payload.accessCode });
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'No se pudo emitir el código.');
    }
  };

  const availableCouriers = data.couriers.filter(
    (courier) =>
      courier.status === 'AVAILABLE' &&
      courier.currentLat !== null &&
      courier.currentLng !== null &&
      isCourierLocationFresh(courier.lastLocationAt ? new Date(courier.lastLocationAt) : null)
  );
  const connectedCourierCount = data.couriers.filter(
    (courier) =>
      courier.status !== 'OFFLINE' &&
      isCourierLocationFresh(courier.lastLocationAt ? new Date(courier.lastLocationAt) : null)
  ).length;
  const summaryMetrics: Array<{ label: string; value: number; warning: boolean }> = [
    { label: 'Repartidores conectados', value: connectedCourierCount, warning: false },
    { label: 'Rutas activas', value: activeRoutes.length, warning: false },
    { label: 'Paradas activas', value: pendingStops, warning: false },
    {
      label: data.metrics.timeSavedMinutes >= 0 ? 'Minutos ahorrados' : 'Minutos extra',
      value: Math.round(Math.abs(data.metrics.timeSavedMinutes)),
      warning: data.metrics.timeSavedMinutes < 0,
    },
    {
      label: data.metrics.distanceSavedMeters >= 0 ? 'Km ahorrados' : 'Km extra',
      value: Math.round(Math.abs(data.metrics.distanceSavedMeters) / 100) / 10,
      warning: data.metrics.distanceSavedMeters < 0,
    },
  ];

  return (
    <AppShell active="dispatch">
      <main className="text-slate-950">
        <div className="mx-auto max-w-[1600px] px-5 py-6 sm:px-8 lg:px-10">
          <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Rutas en movimiento
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Supervisa repartidores disponibles y rutas planificadas desde una sola vista
                operativa.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <span className="flex items-center gap-2 text-xs text-slate-600 sm:justify-end">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${loading ? 'bg-amber-500' : 'bg-emerald-600'}`}
                />
                {loading
                  ? 'Sincronizando operación…'
                  : lastUpdatedAt
                    ? `Actualizado ${lastUpdatedAt.toLocaleTimeString('es-CO')}`
                    : 'Actualización automática activa'}
              </span>
              <button
                className="rp-button rp-button-quiet w-full disabled:cursor-wait sm:w-auto"
                disabled={loading}
                onClick={() => void loadDashboard()}
                type="button"
              >
                {loading ? 'Actualizando…' : 'Actualizar datos'}
              </button>
            </div>
          </header>

          {error ? (
            <div
              className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {routeActionNotice ? (
            <p
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
              role="status"
            >
              <span>{routeActionNotice}</span>
              <button
                className="min-h-11 rounded-lg px-2 font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                onClick={() => setRouteActionNotice(null)}
                type="button"
              >
                Cerrar
              </button>
            </p>
          ) : null}

          {data.notificationsWarning ? (
            <p
              className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"
              role="status"
            >
              {data.notificationsWarning}
            </p>
          ) : null}

          {issuedCourierCode ? (
            <section
              className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4"
              aria-label="Código de acceso de repartidor"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-amber-950">
                    Código privado para {issuedCourierCode.courierName}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    Entrégalo directamente al repartidor. No volverá a mostrarse; emitir otro lo
                    invalida.
                  </p>
                </div>
                <button
                  className="text-xs font-semibold text-amber-900 underline"
                  onClick={() => setIssuedCourierCode(null)}
                  type="button"
                >
                  Ocultar
                </button>
              </div>
              <code className="mt-3 block overflow-wrap-anywhere rounded-xl border border-amber-200 bg-white px-3 py-3 text-xs text-slate-900">
                {issuedCourierCode.accessCode}
              </code>
            </section>
          ) : null}

          <section
            aria-label="Mapa y rutas activas"
            className="mb-6 grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
          >
            <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-slate-200/90 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              <div className="space-y-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">Mapa operativo</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                    OSRM traza calles de OpenStreetMap; TomTom ajusta la estimación en algunos
                    tramos cuando está disponible. El mapa no colorea toda la ciudad por tráfico.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">
                  <span className="inline-flex whitespace-nowrap items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    Repartidor
                  </span>
                  <span className="inline-flex whitespace-nowrap items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-purple-500" />
                    Pendiente
                  </span>
                  <span className="inline-flex whitespace-nowrap items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-sky-400" />
                    En camino
                  </span>
                  <span className="inline-flex whitespace-nowrap items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Entregada
                  </span>
                </div>
              </div>
              <RouteMap
                couriers={data.couriers}
                pendingPoints={data.pendingPoints}
                routes={activeRoutes}
              />
            </div>

            <aside className="min-w-0 rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Rutas activas</h2>
                  <p className="mt-1 text-xs text-slate-500">Recorridos planificados y en curso</p>
                </div>
                <span
                  aria-label={`${activeRoutes.length} rutas activas`}
                  className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"
                >
                  {activeRoutes.length}
                </span>
              </div>

              <div className="space-y-3">
                {loading && data.routes.length === 0 ? (
                  <p
                    aria-live="polite"
                    className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500"
                    role="status"
                  >
                    Cargando rutas activas…
                  </p>
                ) : activeRoutes.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-5">
                    <p className="text-sm leading-6 text-slate-600">
                      No hay recorridos activos. El historial queda disponible aquí, sin mezclarse
                      con la operación del día.
                    </p>
                    <Link
                      className="mt-3 inline-flex text-xs font-bold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950"
                      href="#dispatch-orders"
                    >
                      Ir al despacho
                    </Link>
                  </div>
                ) : (
                  activeRoutes.map((route) => (
                    <RouteSummary
                      key={route.id}
                      isRecalculating={recalculatingRouteId === route.id}
                      isUndoing={undoingRouteId === route.id}
                      onRecalculate={recalculateRouteGeometry}
                      onUndo={undoRouteRecalculation}
                      onStatusChange={updateRouteStatus}
                      route={route}
                    />
                  ))
                )}
              </div>
              {historicalRoutes.length > 0 ? (
                <details
                  aria-label="Historial de rutas"
                  className="mt-4 border-t border-slate-100 pt-3"
                >
                  <summary className="cursor-pointer rounded-lg py-2 text-xs font-semibold text-slate-600 outline-offset-4 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-600">
                    Historial de rutas{' '}
                    <span className="ml-1 text-slate-400">({historicalRoutes.length})</span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    {historicalRoutes.map((route) => (
                      <RouteSummary
                        key={route.id}
                        isRecalculating={false}
                        isUndoing={false}
                        onRecalculate={recalculateRouteGeometry}
                        onUndo={undoRouteRecalculation}
                        onStatusChange={updateRouteStatus}
                        route={route}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </aside>
          </section>

          <RoutingMethodology />

          <dl
            aria-label="Resumen operativo"
            className="mb-6 grid grid-cols-2 divide-x divide-y divide-slate-200 border-y border-slate-200/80 py-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0"
          >
            {summaryMetrics.map((metric) => (
              <div className="min-w-0 px-3 py-3 sm:px-4" key={metric.label}>
                <dt className="text-xs font-medium leading-5 text-slate-600">{metric.label}</dt>
                <dd
                  className={`mt-1 text-2xl font-semibold tabular-nums ${metric.warning ? 'text-amber-700' : 'text-slate-950'}`}
                >
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>

          {data.notifications.length > 0 ? (
            <section
              aria-label="Avisos operativos"
              className="mb-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-900">Actividad reciente</h2>
                <span className="text-xs text-slate-500">Avisos del equipo</span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {data.notifications.map((notification) => {
                  const isFailure = notification.kind === 'ROUTE_RECALCULATION_FAILED';
                  return (
                    <article
                      className={`rounded-xl border px-3 py-2 ${isFailure ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}
                      key={notification.id}
                    >
                      <p
                        className={`text-xs font-semibold ${isFailure ? 'text-amber-900' : 'text-slate-800'}`}
                      >
                        {notification.title}
                      </p>
                      <p
                        className={`mt-1 text-xs ${isFailure ? 'text-amber-800' : 'text-slate-600'}`}
                      >
                        {formatNotificationMessage(notification.message)}
                      </p>
                      <time
                        className={`mt-1 block text-[11px] ${isFailure ? 'text-amber-700' : 'text-slate-500'}`}
                      >
                        {new Date(notification.createdAt).toLocaleString('es-CO')}
                      </time>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <CustomerNotificationReadiness
            status={customerNotificationOperationsStatus}
            unavailable={customerNotificationOperationsUnavailable}
          />

          <section
            aria-label="Despachar pedidos"
            className="mb-6 scroll-mt-24 rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] sm:p-6"
            id="dispatch-orders"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Selecciona, analiza y despacha</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                  El sistema asigna los pedidos a los repartidores elegidos por cercanía y balanceo.
                  Después consulta OSRM y, si TomTom está configurado, tráfico en vivo; aplica
                  <strong> nearest neighbor + 2-opt</strong> y guarda el orden final.
                </p>
              </div>
              <Link
                className="rp-button rp-button-secondary rp-button-small shrink-0"
                href="/pedidos"
              >
                + Registrar pedido
              </Link>
            </div>

            {customerNotificationSummary ? (
              (() => {
                const pendingChannels = [
                  customerNotificationSummary.channels.email.queued > 0 &&
                  !customerNotificationSummary.channels.email.configured
                    ? 'correo electrónico'
                    : null,
                  customerNotificationSummary.channels.sms.queued > 0 &&
                  !customerNotificationSummary.channels.sms.configured
                    ? 'SMS'
                    : null,
                ].filter((channel): channel is string => channel !== null);
                const pendingSetup = pendingChannels.length > 0;
                const queuedChannels = [
                  customerNotificationSummary.channels.email.queued > 0
                    ? 'correo electrónico'
                    : null,
                  customerNotificationSummary.channels.sms.queued > 0 ? 'SMS' : null,
                ].filter((channel): channel is string => channel !== null);
                return (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 ${
                  pendingSetup
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : customerNotificationSummary.queued > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                      : 'border-slate-200 bg-slate-50 text-slate-800'
                }`}
                aria-label="Resumen de avisos a clientes"
                role="status"
              >
                <p className="text-sm font-semibold">
                  {pendingSetup
                    ? 'Ruta creada; canal de aviso pendiente de configuración'
                    : customerNotificationSummary.queued > 0
                      ? 'Avisos al cliente en cola'
                      : 'Ruta creada sin avisos al cliente'}
                </p>
                <p className="mt-1 text-sm leading-5">
                  {customerNotificationSummary.queued > 0
                    ? `${customerNotificationSummary.queued} aviso${customerNotificationSummary.queued === 1 ? '' : 's'} de asignación ${customerNotificationSummary.queued === 1 ? 'quedó' : 'quedaron'} en cola por ${queuedChannels.join(' y ')}. `
                    : 'Ningún pedido de esta ruta tenía correo o celular y consentimiento activos. '}
                  {pendingSetup
                    ? 'Abre «Avisos al cliente» para configurar SMTP o Twilio en el backend. Mientras tanto, la ruta y el seguimiento siguen activos.'
                    : customerNotificationSummary.queued > 0
                      ? `Canales solicitados: ${queuedChannels.join(' y ')}. El sistema intentará el aviso de cercanía cuando el GPS reporte al repartidor dentro del radio aproximado de 500 m del destino.`
                      : 'Las rutas y el seguimiento funcionan normalmente.'}
                </p>
              </div>
                );
              })()
            ) : null}

            {liveTrafficNotice ? (
              <div
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950"
                role="status"
              >
                <p className="text-sm font-semibold">Estado de tráfico de la ruta</p>
                <p className="mt-1 text-sm leading-5">{liveTrafficNotice}</p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-slate-200/90 bg-slate-50/40">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">1. Pedidos pendientes</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {selectedPendingIds.length} de {data.pendingPoints.length} seleccionados
                    </p>
                  </div>
                  <button
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-900"
                    onClick={() =>
                      setSelectedPendingIds(
                        selectedPendingIds.length === data.pendingPoints.length
                          ? []
                          : data.pendingPoints.map((point) => point.id)
                      )
                    }
                    type="button"
                  >
                    {selectedPendingIds.length === data.pendingPoints.length &&
                    data.pendingPoints.length > 0
                      ? 'Quitar todos'
                      : 'Seleccionar todos'}
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto p-3">
                  {data.pendingPoints.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-5 text-sm text-slate-500">
                      No hay pedidos pendientes. Registra uno desde el módulo Pedidos.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.pendingPoints.map((point) => {
                        const checked = selectedPendingIds.includes(point.id);
                        return (
                          <label
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 hover:border-slate-300'}`}
                            key={point.id}
                          >
                            <input
                              checked={checked}
                              className="mt-1 h-4 w-4 accent-emerald-700"
                              onChange={() =>
                                setSelectedPendingIds((current) =>
                                  checked
                                    ? current.filter((id) => id !== point.id)
                                    : [...current, point.id]
                                )
                              }
                              type="checkbox"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-3">
                                <span className="font-mono text-xs font-bold text-slate-800">
                                  {formatOrderReference(point.orderId)}
                                </span>
                                <span className="text-[10px] font-semibold text-amber-700">
                                  Pendiente
                                </span>
                              </span>
                              <span className="mt-1 block truncate text-xs text-slate-500">
                                {point.address}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-slate-50/40">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-bold text-slate-900">2. Repartidores disponibles</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Puedes seleccionar más de uno para balancear la carga.
                  </p>
                </div>
                <div className="p-3">
                  {availableCouriers.length === 0 ? (
                    <p className="rounded-xl bg-amber-50 px-3 py-4 text-xs leading-5 text-amber-800">
                      No hay repartidores con GPS disponible. Registra uno o inicia su PWA.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {availableCouriers.map((courier) => {
                        const checked = selectedCourierIds.includes(courier.id);
                        return (
                          <div className="flex items-center gap-2" key={courier.id}>
                            <label
                              className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? 'border-sky-300 bg-sky-50' : 'border-slate-100 hover:border-slate-300'}`}
                            >
                              <input
                                checked={checked}
                                className="h-4 w-4 accent-sky-700"
                                onChange={() =>
                                  setSelectedCourierIds((current) =>
                                    checked
                                      ? current.filter((id) => id !== courier.id)
                                      : [...current, courier.id]
                                  )
                                }
                                type="checkbox"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-800">
                                  {courier.name}
                                </span>
                                <span className="block text-[11px] text-slate-500">
                                  GPS activo · {courier.phone}
                                </span>
                              </span>
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button
                    className="rp-button rp-button-primary mt-4 w-full disabled:cursor-not-allowed"
                    disabled={
                      analyzing ||
                      selectedPendingIds.length === 0 ||
                      selectedCourierIds.length === 0
                    }
                    onClick={() => void analyzeAssignments()}
                    type="button"
                  >
                    {analyzing ? 'Analizando cercanía…' : 'Analizar asignación'}
                  </button>
                </div>
              </div>
            </div>

            {assignmentPreview.length > 0 || unassignedDeliveryPointIds.length > 0 ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-emerald-950">
                      {assignmentPreview.length > 0
                        ? '3. Propuesta lista para despachar'
                        : 'Pedidos pendientes de asignar'}
                    </h3>
                    <p className="mt-1 text-xs text-emerald-800">
                      {assignmentPreview.length > 0
                        ? 'Revisa la distribución antes de consultar OSRM y crear las rutas.'
                        : 'No se asignaron pedidos en este análisis; siguen pendientes y no se despacharán.'}
                    </p>
                  </div>
                  {assignmentPreview.length > 0 ? (
                    <button
                      className="rp-button rp-button-primary disabled:opacity-50"
                      disabled={dispatching}
                      onClick={() => void dispatchAssignments()}
                      type="button"
                    >
                      {dispatching ? 'Calculando ruta y tráfico…' : 'Despachar rutas optimizadas'}
                    </button>
                  ) : null}
                </div>
                {assignmentPreview.length > 0 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {assignmentPreview.map((assignment) => {
                      const courier = data.couriers.find(
                        (item) => item.id === assignment.courierId
                      );
                      return (
                        <div
                          className="rounded-xl border border-emerald-100 bg-white p-3"
                          key={assignment.courierId}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-bold text-slate-800">
                              {courier?.name ?? 'Repartidor'}
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
                              {assignment.deliveryPointIds.length} paradas
                            </span>
                          </div>
                          <ol className="mt-2 space-y-1 text-xs text-slate-600">
                            {assignment.deliveryPointIds.map((id, index) => (
                              <li className="truncate" key={id}>
                                <span className="mr-1 font-bold text-emerald-700">
                                  {index + 1}.
                                </span>
                                {data.pendingPoints.find((point) => point.id === id)?.address ?? id}
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {unassignedDeliveryPointIds.length > 0 ? (
                  <div
                    className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950"
                    aria-live="polite"
                    role="status"
                  >
                    <p className="font-bold">
                      {unassignedDeliveryPointIds.length === 1
                        ? 'Un pedido sigue sin asignar.'
                        : `${unassignedDeliveryPointIds.length} pedidos siguen sin asignar.`}
                    </p>
                    <p className="mt-1 leading-5 text-amber-900">
                      Puede faltar capacidad de ruta, GPS reciente o el pedido pudo cambiar de
                      estado. Estos pedidos siguen pendientes; no se despacharán.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {unassignedDeliveryPointIds.slice(0, 5).map((id) => {
                        const point = data.pendingPoints.find((item) => item.id === id);
                        return (
                          <li className="break-words" key={id}>
                            {point
                              ? `${formatOrderReference(point.orderId)} · ${point.address}`
                              : 'Un pedido seleccionado ya no está disponible.'}
                          </li>
                        );
                      })}
                      {unassignedDeliveryPointIds.length > 5 ? (
                        <li>Y {unassignedDeliveryPointIds.length - 5} más.</li>
                      ) : null}
                    </ul>
                    <button
                      className="rp-button rp-button-quiet rp-button-small mt-3"
                      disabled={loading}
                      onClick={() => {
                        setAssignmentPreview([]);
                        setUnassignedDeliveryPointIds([]);
                        void loadDashboard();
                      }}
                      type="button"
                    >
                      Actualizar pedidos pendientes
                    </button>
                  </div>
                ) : null}
                {assignmentAiStatus ? (
                  <div
                    className="mt-3 rounded-xl border border-white bg-white/80 px-3 py-2 text-xs text-slate-700"
                    role="status"
                  >
                    <span className="font-bold">
                      {assignmentAiStatus.source === 'tomtom-live'
                        ? 'TomTom Traffic Flow priorizado'
                        : assignmentAiStatus.source === 'external-ai' && assignmentAiStatus.applied
                          ? 'Factor de congestión sugerido por IA aplicado'
                          : 'Asignación determinista'}
                      .
                    </span>{' '}
                    {assignmentAiStatus.warning ??
                      'La propuesta se calculó con cercanía y balanceo.'}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    ¿No aparece un repartidor?
                  </h3>
                  <p className="text-xs text-slate-500">
                    Se crea fuera de turno; su primera ubicación válida llega desde el GPS privado
                    de la PWA.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <label className="block text-xs font-semibold text-slate-700">
                  Nombre completo
                  <input
                    className="rp-input mt-1 px-3 py-2.5 text-sm"
                    onChange={(event) =>
                      setCourierDraft((draft) => ({ ...draft, name: event.target.value }))
                    }
                    placeholder="Ej. Camila Ramírez"
                    value={courierDraft.name}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Teléfono
                  <input
                    className="rp-input mt-1 px-3 py-2.5 text-sm"
                    onChange={(event) =>
                      setCourierDraft((draft) => ({ ...draft, phone: event.target.value }))
                    }
                    placeholder="Ej. 300 123 4567"
                    value={courierDraft.phone}
                  />
                </label>
                <button
                  className="rp-button rp-button-secondary disabled:cursor-not-allowed"
                  disabled={creatingCourier}
                  onClick={() => void createCourier()}
                  type="button"
                >
                  {creatingCourier ? 'Guardando…' : 'Registrar'}
                </button>
              </div>
            </div>

            {data.couriers.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-800">Accesos del equipo</h3>
                <p className="mt-1 text-xs text-slate-500">
                  El código nuevo se muestra una sola vez. Entrégalo directamente a su titular.
                </p>
                <ul className="mt-3 divide-y divide-slate-100">
                  {data.couriers.map((courier) => (
                    <li className="flex items-center justify-between gap-3 py-2.5" key={courier.id}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {courier.name}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {isCourierLocationFresh(
                            courier.lastLocationAt ? new Date(courier.lastLocationAt) : null
                          )
                            ? courier.status === 'AVAILABLE'
                              ? 'Disponible · GPS reciente'
                              : courier.status === 'ON_ROUTE'
                                ? 'En ruta · GPS reciente'
                                : 'Fuera de línea'
                            : courier.lastLocationAt
                              ? `GPS vencido · última lectura ${new Date(courier.lastLocationAt).toLocaleTimeString('es-CO')}`
                              : 'Sin ubicación GPS'}
                        </span>
                      </span>
                      <button
                        className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:border-amber-300 hover:text-amber-800"
                        onClick={() => void rotateCourierAccessCode(courier)}
                        type="button"
                      >
                        Emitir código
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function summarizeLiveTraffic(statuses: LiveTrafficStatus[]): string {
  const configured = statuses.some((status) => status.configured);
  const routeSegments = statuses.reduce((total, status) => total + status.routeSegments, 0);
  const sampledSegments = statuses.reduce((total, status) => total + status.sampledSegments, 0);
  const adjustedSegments = statuses.reduce((total, status) => total + status.adjustedSegments, 0);
  const closedSegments = statuses.reduce((total, status) => total + status.closedSegments, 0);
  const warnings = [...new Set(statuses.map((status) => status.warning).filter(Boolean))];
  const sourceSummary = configured
    ? `TomTom midió ${sampledSegments} de ${routeSegments} tramos y ajustó ${adjustedSegments}${closedSegments > 0 ? `; marcó ${closedSegments} como cerrados` : ''}.`
    : 'TomTom aún no está configurado; se conservaron los tiempos de calles de OSRM.';
  return [sourceSummary, ...warnings].join(' ');
}

function isCustomerNotificationSummary(value: unknown): value is CustomerNotificationSummary {
  if (typeof value !== 'object' || value === null || !('channels' in value)) {
    return false;
  }
  const summary = value as Partial<CustomerNotificationSummary>;
  const validChannel = (channel: unknown): boolean =>
    typeof channel === 'object' &&
    channel !== null &&
    'queued' in channel &&
    typeof channel.queued === 'number' &&
    Number.isSafeInteger(channel.queued) &&
    channel.queued >= 0 &&
    'configured' in channel &&
    typeof channel.configured === 'boolean';
  const channels = summary.channels;
  return (
    Number.isSafeInteger(summary.queued) &&
    (summary.queued ?? -1) >= 0 &&
    typeof channels === 'object' &&
    channels !== null &&
    validChannel(channels.email) &&
    validChannel(channels.sms) &&
    (summary.warning === undefined ||
      summary.warning === null ||
      typeof summary.warning === 'string')
  );
}

function RouteSummary({
  isUndoing,
  isRecalculating,
  onRecalculate,
  onUndo,
  onStatusChange,
  route,
}: {
  isRecalculating: boolean;
  isUndoing: boolean;
  onRecalculate: (routeId: string) => Promise<void>;
  onUndo: (routeId: string) => Promise<void>;
  onStatusChange: (
    routeId: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  ) => Promise<void>;
  route: Route;
}) {
  const statusLabels = {
    PLANNED: 'Planificada',
    IN_PROGRESS: 'En progreso',
    COMPLETED: 'Completada',
    CANCELLED: 'Cancelada',
  } as const;
  const statusTone = {
    PLANNED: 'bg-sky-50 text-sky-800',
    IN_PROGRESS: 'bg-emerald-50 text-emerald-800',
    COMPLETED: 'bg-slate-100 text-slate-600',
    CANCELLED: 'bg-slate-100 text-slate-500',
  } as const;
  const hasFreshCourierLocation =
    route.courier.currentLat !== null &&
    route.courier.currentLng !== null &&
    isCourierLocationFresh(
      route.courier.lastLocationAt ? new Date(route.courier.lastLocationAt) : null
    );
  const canRecalculate = route.status === 'PLANNED' || route.status === 'IN_PROGRESS';

  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800">{route.courier.name}</p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">{route.id.slice(0, 8)}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone[route.status]}`}
        >
          {statusLabels[route.status]}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-slate-400">Duración</p>
          <p className="mt-1 font-semibold text-slate-700">
            {Math.round(route.estimatedDurationMinutes)} min
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-slate-400">Paradas</p>
          <p className="mt-1 font-semibold text-slate-700">{route.deliveryPoints.length}</p>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
        <p className="font-semibold text-slate-700">Orden optimizado</p>
        <p className="mt-1 truncate text-slate-500">
          {route.deliveryPoints.length > 0
            ? route.deliveryPoints
                .map((point, index) => `${index + 1}. ${point.address}`)
                .join(' → ')
            : 'Sin paradas'}
        </p>
        <p className="mt-2 text-[10px] text-slate-400">
          OSRM calcula calles y tiempos base; TomTom ajusta tramos medidos cuando está activo.
        </p>
      </div>
      {canRecalculate && !isRoadGeometryProvider(route.geometryProvider) ? (
        <div
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950"
          role="status"
        >
          <p className="font-semibold">Trazado antiguo sin verificar</p>
          <p className="mt-1 leading-5">
            No se mostrará como si siguiera calles. Recalcula la ruta para confirmar su geometría
            con OSRM.
          </p>
          {canRecalculate && hasFreshCourierLocation ? (
            <button
              className="rp-button rp-button-primary rp-button-small mt-2"
              disabled={isRecalculating}
              onClick={() => void onRecalculate(route.id)}
              type="button"
            >
              {isRecalculating ? 'Consultando OSRM…' : 'Recalcular por calles'}
            </button>
          ) : null}
          {canRecalculate && !hasFreshCourierLocation ? (
            <p className="mt-2 leading-5 text-amber-800">
              El repartidor debe compartir una ubicación GPS reciente antes de recalcular.
            </p>
          ) : null}
        </div>
      ) : null}
      {route.status === 'PLANNED' || route.status === 'IN_PROGRESS' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {route.canUndo ? (
            <button
              aria-label={`Deshacer último recálculo de la ruta de ${route.courier.name}`}
              className="rp-button rp-button-secondary rp-button-small"
              disabled={isUndoing || isRecalculating}
              onClick={() => void onUndo(route.id)}
              type="button"
            >
              {isUndoing ? 'Restaurando…' : 'Deshacer último recálculo'}
            </button>
          ) : null}
          {route.status === 'PLANNED' ? (
            <button
              className="rp-button rp-button-primary rp-button-small"
              onClick={() => void onStatusChange(route.id, 'IN_PROGRESS')}
              type="button"
            >
              Iniciar ruta
            </button>
          ) : (
            <button
              className="rp-button rp-button-primary rp-button-small"
              onClick={() => void onStatusChange(route.id, 'COMPLETED')}
              type="button"
            >
              Completar ruta
            </button>
          )}
          <button
            className="rp-button rp-button-danger rp-button-small"
            onClick={() => void onStatusChange(route.id, 'CANCELLED')}
            type="button"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </article>
  );
}
