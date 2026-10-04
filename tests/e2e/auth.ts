import type { Page } from "@playwright/test";

export const E2E_AUTH_SECRET = "rutas-pasto-e2e-session-secret-32-bytes-minimum";
export const E2E_DISPATCHER_CODE = "rutas-pasto-e2e-dispatcher-code-32-chars";

export async function loginAsDispatcher(page: Page): Promise<void> {
  await page.goto("/acceso");
  await expectNoPublicRoleSelector(page);
  await page.locator("#access-code").fill(E2E_DISPATCHER_CODE);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/dashboard");
}

async function expectNoPublicRoleSelector(page: Page): Promise<void> {
  if (await page.locator("#staff-role").count() > 0) {
    throw new Error("La pantalla pública no debe permitir elegir un rol interno.");
  }
}

export async function loginAsCourier(page: Page, accessCode: string): Promise<void> {
  await page.context().request.post("/api/auth/logout");
  await page.goto("/acceso");
  await page.locator("#access-code").fill(accessCode);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/repartidor");
}

export async function reportCourierPosition(
  page: Page,
  accessCode: string,
  latitude = 1.2136,
  longitude = -77.2811,
): Promise<void> {
  const request = page.context().request;
  await request.post("/api/auth/logout");
  const login = await request.post("/api/auth/login", { data: { accessCode } });
  if (!login.ok()) {
    throw new Error("No se pudo iniciar sesión como repartidor para informar GPS.");
  }
  const location = await request.post("/api/repartidores/me/ubicacion", {
    data: { lat: latitude, lng: longitude, recordedAt: new Date().toISOString() },
  });
  const locationPayload = location.ok()
    ? (await location.json()) as { accepted?: unknown }
    : null;
  await request.post("/api/auth/logout");
  if (!location.ok() || locationPayload?.accepted !== true) {
    throw new Error("El servidor rechazó la ubicación de prueba del repartidor.");
  }
}
