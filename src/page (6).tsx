"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { formatOrderReference } from "@/lib/formatOrderReference";
import { buildCustomerEmailConsent } from "@/lib/customerEmailConsent";
import { buildCustomerSmsConsent } from "@/lib/customerSmsConsent";
import {
  isWithinPastoServiceArea,
  normalizePastoAddress,
} from "@/lib/pastoArea";
import type { MapDeliveryPoint } from "@/components/MapLibreRouteMap";

const OrderMap = dynamic(() => import("@/components/MapLibreRouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[460px] items-center justify-center bg-slate-900 text-sm text-slate-400">
      Cargando mapa de Pasto…
    </div>
  ),
});

interface OrderDraft {
  address: string;
  orderId: string;
  lat: string;
  lng: string;
  customerEmail: string;
  emailNotificationsEnabled: boolean;
  customerPhone: string;
  smsNotificationsEnabled: boolean;
}

interface AddressNormalizationStatus {
  source: "external-ai" | "deterministic";
  confidence?: number;
  warning?: string;
}

interface PendingOrderPoint extends MapDeliveryPoint {
  orderId: string;
}

export default function OrdersPage() {
  const [draft, setDraft] = useState<OrderDraft>({
    address: "",
    orderId: "",
    lat: "",
    lng: "",
    customerEmail: "",
    emailNotificationsEnabled: false,
    customerPhone: "",
    smsNotificationsEnabled: false,
  });
  const [pendingPoints, setPendingPoints] = useState<PendingOrderPoint[]>([]);
  const [selectedCoordinate, setSelectedCoordinate] = useState<[number, number] | null>(null);
  const [normalization, setNormalization] = useState<AddressNormalizationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPendingOrders = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/pedidos?status=PENDING", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("No se pudieron cargar los pedidos pendientes.");
      }

      const payload = (await response.json()) as {
        deliveryPoints: Array<{
          id: string;
          orderId: string;
          address: string;
          lat: number;
          lng: number;
          status: "PENDING";
        }>;
      };

      setPendingPoints(
        payload.deliveryPoints.map((point) => ({
          ...point,
          sequenceIndex: null,
        })),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los pedidos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPendingOrders();
  }, [loadPendingOrders]);

  const handleMapClick = ({ lat, lng }: { lat: number; lng: number }) => {
    setSelectedCoordinate([lat, lng]);
    setDraft((current) => ({
      ...current,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
    }));
    setError(null);
    setSuccess(null);
  };

  const createOrder = async (): Promise<void> => {
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);
    const emailConsent = buildCustomerEmailConsent(
      draft.customerEmail,
      draft.emailNotificationsEnabled,
    );
    const smsConsent = buildCustomerSmsConsent(
      draft.customerPhone,
      draft.smsNotificationsEnabled,
    );

    if (
      draft.address.trim() === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !isWithinPastoServiceArea(lat, lng)
    ) {
      setError("Escribe una dirección y selecciona un punto dentro de Pasto en el mapa.");
      return;
    }
    if (emailConsent === null) {
      setError("Para activar los avisos, escribe un correo electrónico válido.");
      return;
    }
    if (smsConsent === null) {
      setError("Para activar los avisos por SMS, escribe un celular colombiano válido.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: normalizePastoAddress(draft.address),
          lat,
          lng,
          orderId: draft.orderId.trim() || `PED-${Date.now()}`,
          ...emailConsent,
          ...smsConsent,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "No se pudo registrar el pedido."));
      }

      const payload = (await response.json()) as {
        deliveryPoint: { orderId: string; address: string };
        trackingGuide: string;
        addressNormalization?: AddressNormalizationStatus;
      };
      setNormalization(payload.addressNormalization ?? null);
      setSuccess(
        `Pedido ${formatOrderReference(payload.deliveryPoint.orderId)} listo. Guía privada para el cliente: ${payload.trackingGuide}.${
          emailConsent.emailNotificationsEnabled || smsConsent.smsNotificationsEnabled
            ? " La solicitud de avisos quedó guardada; su entrega depende de que el canal elegido esté configurado."
            : ""
        }`,
      );
      setDraft({
        address: "",
        orderId: "",
        lat: "",
        lng: "",
        customerEmail: "",
        emailNotificationsEnabled: false,
        customerPhone: "",
        smsNotificationsEnabled: false,
      });
      setSelectedCoordinate(null);
      await loadPendingOrders();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo registrar el pedido.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell active="orders">
      <main className="mx-auto max-w-[1600px] px-5 py-6 sm:px-8 lg:px-10">
        <section className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Registrar un pedido
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Cada pedido queda pendiente hasta que el despacho lo asigne a un repartidor.
              Normalizamos abreviaturas locales y validamos el punto exacto en el mapa.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-right shadow-sm">
            <p className="text-2xl font-bold tabular-nums text-emerald-800">{pendingPoints.length}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">pendientes</p>
          </div>
        </section>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {normalization ? (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs text-teal-800">
            {normalization.source === "external-ai"
              ? `La IA normalizó la dirección con ${Math.round((normalization.confidence ?? 0) * 100)}% de confianza.`
              : normalization.warning ?? "La dirección fue normalizada localmente."}
          </div>
        ) : null}

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="font-semibold text-white">Pasto · selecciona una ubicación</h2>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300">
                Solo Pasto
              </span>
            </div>
            <div className="h-[560px]">
              <OrderMap
                ariaLabel="Mapa para seleccionar la dirección del pedido"
                className="h-full w-full"
                couriers={[]}
                pendingPoints={pendingPoints}
                routes={[]}
                selectedCoordinate={selectedCoordinate}
                onMapClick={handleMapClick}
              />
            </div>
          </div>

          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
              <div>
                <h2 className="font-semibold text-slate-900">Datos del pedido</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Normalizamos “num.”, “cra.” y otras abreviaturas locales de Pasto.
                </p>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block text-xs font-semibold text-slate-600">
                  Dirección
                  <input
                    className="rp-input mt-1.5 px-3 py-3 text-sm font-normal"
                    onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))}
                    placeholder="Ej. Carrera 25 num 4 sur 65"
                    value={draft.address}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Referencia interna del pedido (opcional)
                  <input
                    className="rp-input mt-1.5 px-3 py-3 font-mono text-sm font-normal"
                    onChange={(event) => setDraft((current) => ({ ...current, orderId: event.target.value }))}
                    placeholder="Ej. RP-10025 (opcional)"
                    value={draft.orderId}
                  />
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-medium leading-5 text-slate-700">
                    <input
                      checked={draft.emailNotificationsEnabled}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          emailNotificationsEnabled: event.target.checked,
                          customerEmail: event.target.checked ? current.customerEmail : "",
                        }))
                      }
                      type="checkbox"
                    />
                    <span>El cliente acepta recibir avisos por correo sobre su entrega.</span>
                  </label>
                  {draft.emailNotificationsEnabled ? (
                    <label className="mt-3 block text-xs font-semibold text-slate-600">
                      Correo del cliente
                      <input
                        autoComplete="email"
                        className="rp-input mt-1.5 px-3 py-3 text-sm font-normal"
                        maxLength={320}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, customerEmail: event.target.value }))
                        }
                        placeholder="cliente@ejemplo.com"
                        required
                        type="email"
                        value={draft.customerEmail}
                      />
                    </label>
                  ) : null}
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    Solo se usarán los canales autorizados para avisar cuando el pedido tenga repartidor asignado y cuando el repartidor esté cerca.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-medium leading-5 text-slate-700">
                    <input
                      checked={draft.smsNotificationsEnabled}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          smsNotificationsEnabled: event.target.checked,
                          customerPhone: event.target.checked ? current.customerPhone : "",
                        }))
                      }
                      type="checkbox"
                    />
                    <span>El cliente acepta recibir avisos SMS en su celular.</span>
                  </label>
                  {draft.smsNotificationsEnabled ? (
                    <label className="mt-3 block text-xs font-semibold text-slate-600">
                      Celular del cliente
                      <input
                        autoComplete="tel"
                        className="rp-input mt-1.5 px-3 py-3 text-sm font-normal"
                        inputMode="tel"
                        maxLength={30}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, customerPhone: event.target.value }))
                        }
                        placeholder="300 123 4567"
                        required
                        type="tel"
                        value={draft.customerPhone}
                      />
                    </label>
                  ) : null}
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    El número se guarda solo con consentimiento y se usa únicamente para los avisos de asignación y cercanía. La entrega requiere configurar SMS.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Coordenadas seleccionadas</span>
                  <p className="mt-1 font-mono text-[11px]">
                    {selectedCoordinate ? `${draft.lat}, ${draft.lng}` : "Haz clic dentro del mapa"}
                  </p>
                </div>
                <button
                  className="rp-button rp-button-primary w-full disabled:cursor-wait"
                  disabled={saving}
                  onClick={() => void createOrder()}
                  type="button"
                >
                  {saving ? "Registrando…" : "Registrar pedido pendiente"}
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Últimos pendientes</h2>
                  <p className="mt-1 text-xs text-slate-500">Aparecerán en el centro de despacho.</p>
                </div>
                {loading ? <span className="text-xs text-slate-400">Cargando…</span> : null}
              </div>
              <div className="mt-4 space-y-2">
                {pendingPoints.slice(0, 6).map((point) => (
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5" key={point.id}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-semibold text-slate-700">{formatOrderReference(point.orderId)}</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pendiente</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{point.address}</p>
                  </div>
                ))}
                {pendingPoints.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">
                    No hay pendientes. Registra el primero para enviarlo al despacho.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "error" | "success" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {children}
    </div>
  );
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}
