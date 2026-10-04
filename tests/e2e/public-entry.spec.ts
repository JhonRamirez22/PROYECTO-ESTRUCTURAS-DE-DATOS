import { expect, test } from '@playwright/test';

test('la portada separa el acceso operativo del seguimiento y se adapta a móvil', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Del pedido pendiente a la puerta, sin perder el hilo.' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '¿Qué necesitas hacer?' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Información útil, ligada a tu pedido' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Rutas por calles, con un orden que se puede explicar.' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mejora local con 2-opt' })).toBeVisible();
  await expect(page.getByText(/no una garantía de óptimo/)).toBeVisible();
  await expect(page.getByText(/listas dobles para cachés LRU/)).toBeVisible();
  await expect(page.getByText(/correo, SMS o ambos/)).toBeVisible();
  await expect(page.getByText(/no se envía el texto libre original/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Soy repartidor o despachador/ })).toHaveAttribute(
    'href',
    '/acceso'
  );
  await expect(page.getByRole('link', { name: /Soy cliente/ })).toHaveAttribute('href', '/cliente');

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '¿Qué necesitas hacer?' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
});

test('respeta reducir movimiento sin quitar el feedback de color de las acciones', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const action = page.getByRole('link', { name: /Soy repartidor o despachador/ });
  const arrow = action.locator('svg');
  await expect(action).toBeVisible();
  await expect
    .poll(() => arrow.evaluate((element) => getComputedStyle(element).transitionProperty))
    .toBe('none');
  await expect
    .poll(() => action.evaluate((element) => getComputedStyle(element).transitionDuration))
    .toBe('0.2s');
});
