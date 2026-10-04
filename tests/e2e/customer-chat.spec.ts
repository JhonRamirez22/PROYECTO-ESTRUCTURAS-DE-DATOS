import { expect, test } from '@playwright/test';
import { loginAsDispatcher } from './auth';

const GUIDE = 'E2E-CUSTOMER-CHAT-GUIDE';
const PROVIDER_NOTICE =
  'Privacidad: la IA recibe solo la intención normalizada y el estado; el texto original no se comparte. ' +
  'No se envían guía, dirección, coordenadas, nombre, teléfono ni IDs. ' +
  'Si preguntas por la llegada, el ETA es aproximado; TomTom, si está disponible, solo cubre ' +
  'parte del primer tramo, no toda la ruta. El chat se limita a este pedido.';

test('el cliente pregunta por su guía y el chat se adapta a móvil', async ({ page }, testInfo) => {
  let chatPayload: unknown;

  await page.route('https://tiles.openfreemap.org/styles/fiord', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'estilo de mapa para prueba',
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#17242b' },
          },
        ],
      }),
    })
  );
  await page.route('**/api/seguimiento**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('guia') !== GUIDE) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tracking: {
          guide: GUIDE,
          status: 'PENDING',
          address: 'Carrera 25 # 4 sur 65',
          coordinates: { lat: 1.2136, lng: -77.2811 },
          route: null,
        },
      }),
    });
  });
  await page.route('**/api/cliente/chat', async (route) => {
    chatPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Tu pedido fue recibido y aún no tiene una ruta asignada.',
        scope: 'order',
        providerNotice: PROVIDER_NOTICE,
      }),
    });
  });
  await page.route('**/api/cliente/chat/estado', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true }),
    })
  );

  await page.goto('/cliente');
  await expect(page.getByPlaceholder('Pega aquí tu guía privada')).toBeVisible();
  await expect(page.getByText('Es distinta al número de pedido.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Qué verás al consultar' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Número de guía' }).fill(GUIDE);
  await page.getByRole('button', { name: 'Buscar pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Qué verás al consultar' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '¿Tienes dudas sobre este pedido?' })
  ).toBeVisible();
  const privacyDisclosure = page.getByText(
    /a la IA solo se envían la intención normalizada y el estado del pedido/i
  );
  await expect(privacyDisclosure).toBeVisible();
  await privacyDisclosure.click();
  await expect(page.getByText(/el texto original no se comparte/i)).toBeVisible();
  await expect(
    page.getByText(/no se envían guía, dirección, coordenadas, nombre, teléfono ni IDs/i)
  ).toBeVisible();
  await expect(
    page.getByText(/TomTom, si está disponible, solo cubre parte del primer tramo, no toda la ruta/i)
  ).toBeVisible();
  await expect(page.getByText(/el chat se limita a este pedido/i)).toBeVisible();
  await privacyDisclosure.click();
  const trackingMap = page.getByRole('region', { name: 'Mapa de seguimiento del pedido' });
  await expect(trackingMap.locator('.maplibregl-canvas')).toBeVisible();
  await expect(trackingMap.getByRole('status')).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Escribe tu pregunta sobre el pedido' })
    .fill('¿Ya viene?');
  await page.getByRole('button', { name: 'Preguntar' }).click();
  await expect(
    page.getByText('Tu pedido fue recibido y aún no tiene una ruta asignada.')
  ).toBeVisible();
  expect(chatPayload).toEqual({
    guide: GUIDE,
    messages: [{ role: 'user', content: '¿Ya viene?' }],
  });
  await page
    .getByRole('heading', { name: '¿Tienes dudas sobre este pedido?' })
    .scrollIntoViewIfNeeded();
  await page
    .locator('section[aria-labelledby="customer-order-chat-title"]')
    .screenshot({ path: testInfo.outputPath('customer-chat-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: '¿Tienes dudas sobre este pedido?' })
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page
    .locator('section[aria-labelledby="customer-order-chat-title"]')
    .screenshot({ path: testInfo.outputPath('customer-chat-mobile.png') });
});

test('el seguimiento sigue disponible cuando el asistente está apagado', async ({ page }) => {
  const guide = 'E2E-CHAT-UNAVAILABLE';

  await page.route('https://tiles.openfreemap.org/styles/fiord', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'estilo de mapa para prueba',
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#17242b' } },
        ],
      }),
    })
  );
  await page.route('**/api/seguimiento**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tracking: {
          guide,
          status: 'PENDING',
          address: 'Carrera 25 # 4 sur 65',
          coordinates: { lat: 1.2136, lng: -77.2811 },
          route: null,
        },
      }),
    })
  );
  await page.route('**/api/cliente/chat/estado', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: false }),
    })
  );

  await page.goto('/cliente');
  await page.getByRole('textbox', { name: 'Número de guía' }).fill(guide);
  await page.getByRole('button', { name: 'Buscar pedido' }).click();

  await expect(
    page.getByRole('heading', { name: '¿Tienes dudas sobre este pedido?' })
  ).toBeVisible();
  await expect(page.getByText('Carrera 25 # 4 sur 65')).toBeVisible();
  await expect(page.getByText(/El asistente no está configurado por ahora/)).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Escribe tu pregunta sobre el pedido' })
  ).toHaveCount(0);
});

test('conserva el último seguimiento cuando falla una actualización', async ({ page }, testInfo) => {
  const guide = 'E2E-TRACKING-STALE';
  let requestCount = 0;

  await page.route('https://tiles.openfreemap.org/styles/fiord', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'estilo de mapa para prueba',
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#17242b' } },
        ],
      }),
    })
  );
  await page.route('**/api/seguimiento**', async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Servicio temporalmente no disponible.' }),
      });
      return;
    }
    if (requestCount > 2) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'La guía ya no está disponible.' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tracking: {
          guide,
          status: 'PENDING',
          address: 'Carrera 25 # 4 sur 65',
          coordinates: { lat: 1.2136, lng: -77.2811 },
          route: null,
        },
      }),
    });
  });
  await page.route('**/api/cliente/chat/estado', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: false }),
    })
  );

  await page.goto('/cliente');
  await page.getByRole('textbox', { name: 'Número de guía' }).fill(guide);
  await page.getByRole('button', { name: 'Buscar pedido' }).click();

  await expect(page.getByText('Carrera 25 # 4 sur 65')).toBeVisible();
  await expect(page.getByText(/Última consulta/)).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar ubicación' }).click();

  await expect(page.getByText(/No pudimos actualizar ahora\. Conservamos la última información/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('customer-tracking-stale-desktop.png'),
    fullPage: true,
  });
  await expect(page.getByText('Carrera 25 # 4 sur 65')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mapa de seguimiento del pedido' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '¿Tienes dudas sobre este pedido?' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar ubicación' })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Carrera 25 # 4 sur 65')).toBeVisible();
  await expect(
    page.getByText(/No pudimos actualizar ahora\. Conservamos la última información/)
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('customer-tracking-stale-mobile.png'),
    fullPage: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: 'Actualizar ubicación' }).click();
  await expect(page.getByText('La guía ya no está disponible.')).toBeVisible();
  await expect(page.getByText('Carrera 25 # 4 sur 65')).toHaveCount(0);
});

test('el consentimiento por correo y SMS es claro y adaptable en el formulario de pedidos', async ({
  page,
}, testInfo) => {
  await page.route('https://tiles.openfreemap.org/styles/fiord', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'estilo de mapa para prueba',
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#17242b' },
          },
        ],
      }),
    })
  );
  await page.route('**/api/pedidos?status=PENDING', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ deliveryPoints: [] }),
    })
  );
  await loginAsDispatcher(page);
  await page.goto('/pedidos');

  await expect(page.getByRole('heading', { name: 'Registrar un pedido' })).toBeVisible();
  const orderMap = page.getByLabel('Mapa para seleccionar la dirección del pedido');
  await expect(orderMap.locator('.maplibregl-canvas')).toBeVisible();
  await expect(orderMap.getByRole('status')).toHaveCount(0);
  await expect(
    page.getByText(
      'Solo se usarán los canales autorizados para avisar cuando el pedido tenga repartidor asignado y cuando el repartidor esté cerca.'
    )
  ).toBeVisible();
  const consent = page.getByRole('checkbox', {
    name: 'El cliente acepta recibir avisos por correo sobre su entrega.',
  });
  await expect(page.getByRole('textbox', { name: 'Correo del cliente' })).toHaveCount(0);
  await consent.check();
  const email = page.getByRole('textbox', { name: 'Correo del cliente' });
  await expect(email).toBeVisible();

  const smsConsent = page.getByRole('checkbox', {
    name: 'El cliente acepta recibir avisos SMS en su celular.',
  });
  await expect(page.getByRole('textbox', { name: 'Celular del cliente' })).toHaveCount(0);
  await smsConsent.check();
  const phone = page.getByRole('textbox', { name: 'Celular del cliente' });
  await expect(phone).toBeVisible();

  await email.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('order-email-consent-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await phone.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('order-email-consent-mobile.png') });
});
