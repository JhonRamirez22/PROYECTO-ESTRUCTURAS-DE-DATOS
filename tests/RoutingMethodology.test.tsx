import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RoutingMethodology from '@/components/RoutingMethodology';

describe('RoutingMethodology', () => {
  afterEach(cleanup);

  it('explains the operational route pipeline without overstating traffic or graph routing', () => {
    render(<RoutingMethodology />);

    expect(screen.getByText('Cómo se calcula el despacho')).toBeTruthy();
    expect(screen.getByText('Nearest neighbor + 2-opt')).toBeTruthy();
    expect(screen.getByText(/TomTom solo ajusta los segmentos muestreados/)).toBeTruthy();
    expect(screen.getByText(/no sustituyen al motor OSRM/)).toBeTruthy();
    expect(screen.getByText(/deshacer el último mientras la ruta siga activa/)).toBeTruthy();
  });

  it('documents order-scoped chat and consent-gated notifications', () => {
    render(<RoutingMethodology />);

    expect(screen.getByText(/solo responde sobre ese pedido/)).toBeTruthy();
    expect(screen.getByText(/requieren consentimiento y un canal configurado/)).toBeTruthy();
  });
});
