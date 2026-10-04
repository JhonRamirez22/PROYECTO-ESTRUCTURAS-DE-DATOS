import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loginAsCourier, loginAsDispatcher, reportCourierPosition } from "./auth";
import { cleanupTestData } from "./cleanup";

const COURIER_LOCATION = { lat: 1.2136, lng: -77.2811 };

interface ChannelCounts {
  configured: boolean;
  pending: number;
  retrying: number;
  processing: number;
  failed: number;
}

interface NotificationStatus {
  channels: {
    email: ChannelCounts;
    sms: ChannelCounts;
  };
}

test("avisa por correo y SMS al asignar y al acercarse el repartidor", async ({ page }) => {
  await loginAsDispatcher(page);
  const request = page.context().request;
  const suffix = randomUUID();
  const orderId = `E2E-NOTIFICATION-${suffix}`;
  let courierId: string | undefined;
  let deliveryPointId: string | undefined;

  try {
    const courierResponse = await request.post("/api/repartidores", {
      data: {
        name: `Notification courier ${suffix}`,
        phone: `+57302${Date.now().toString().slice(-7)}`,
      },
    });
    expect(courierResponse.status()).toBe(201);
    const courier = (await courierResponse.json()) as {
      courier: { id: string };
      accessCode: string;
    };
    courierId = courier.courier.id;
    await reportCourierPosition(page, courier.accessCode, COURIER_LOCATION.lat, COURIER_LOCATION.lng);
    await loginAsDispatcher(page);

    const orderResponse = await request.post("/api/pedidos", {
      data: {
        address: "Carrera 25 # 4 sur 65, Pasto",
        ...COURIER_LOCATION,
        orderId,
        customerEmail: `customer-${suffix}@example.invalid`,
        emailNotificationsEnabled: true,
        customerPhone: "+573001234567",
        smsNotificationsEnabled: true,
      },
    });
    expect(orderResponse.status()).toBe(201);
    const order = (await orderResponse.json()) as {
      deliveryPoint: { id: string };
    };
    deliveryPointId = order.deliveryPoint.id;

    const statusBefore = await readNotificationStatus(request);
    const routeResponse = await request.post("/api/asignaciones/aplicar", {
      data: {
        assignments: [{ courierId, deliveryPointIds: [deliveryPointId] }],
      },
    });
    expect(routeResponse.status()).toBe(201);
    const assignment = (await routeResponse.json()) as {
      routes: Array<{ route: { id: string } }>;
      customerNotifications: {
        queued: number;
        channels: {
          email: { queued: number; configured: boolean };
          sms: { queued: number; configured: boolean };
        };
      };
    };
    expect(assignment.customerNotifications).toEqual({
      queued: 2,
      channels: {
        email: { queued: 1, configured: false },
        sms: { queued: 1, configured: false },
      },
      warning: "Configura SMTP y Twilio SMS para entregar los avisos.",
    });
    const routeId = assignment.routes[0]?.route.id;
    expect(routeId).toBeTruthy();

    const statusAfterAssignment = await readNotificationStatus(request);
    expect(statusAfterAssignment.channels.email.pending).toBe(
      statusBefore.channels.email.pending + 1,
    );
    expect(statusAfterAssignment.channels.sms.pending).toBe(
      statusBefore.channels.sms.pending + 1,
    );

    const startRouteResponse = await request.patch(`/api/rutas/${routeId}`, {
      data: { status: "IN_PROGRESS" },
    });
    expect(startRouteResponse.status()).toBe(200);

    await loginAsCourier(page, courier.accessCode);
    const nearbyPositionResponse = await request.post("/api/repartidores/me/ubicacion", {
      data: { ...COURIER_LOCATION, recordedAt: new Date().toISOString() },
    });
    expect(nearbyPositionResponse.status()).toBe(201);
    expect(await nearbyPositionResponse.json()).toMatchObject({ accepted: true });

    await loginAsDispatcher(page);
    const statusAfterNearby = await readNotificationStatus(request);
    expect(statusAfterNearby.channels.email.pending).toBe(
      statusBefore.channels.email.pending + 2,
    );
    expect(statusAfterNearby.channels.sms.pending).toBe(
      statusBefore.channels.sms.pending + 2,
    );
    expect(statusAfterNearby.channels.email.configured).toBe(false);
    expect(statusAfterNearby.channels.sms.configured).toBe(false);
  } finally {
    await cleanupTestData({
      courierId,
      deliveryPointIds: deliveryPointId ? [deliveryPointId] : [],
      orderIds: [orderId],
    });
  }
});

async function readNotificationStatus(
  request: import("@playwright/test").APIRequestContext,
): Promise<NotificationStatus> {
  const response = await request.get("/api/notificaciones/clientes/estado");
  expect(response.status()).toBe(200);
  return (await response.json()) as NotificationStatus;
}
