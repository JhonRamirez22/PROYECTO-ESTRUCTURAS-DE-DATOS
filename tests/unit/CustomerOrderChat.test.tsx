import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerOrderChat from '@/components/CustomerOrderChat';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

describe('CustomerOrderChat', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends the private tracking guide to the backend and renders its scoped reply', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Tu pedido ya fue asignado a una ruta.',
          scope: 'order',
          providerNotice: 'Se normaliza la pregunta y se comparte el estado básico del pedido.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    expect(await screen.findByText('IA configurada')).toBeTruthy();
    expect(
      screen.getByText(/la conexión con el proveedor se confirma al enviar/i)
    ).toBeTruthy();
    const input = await screen.findByRole('textbox', {
      name: 'Escribe tu pregunta sobre el pedido',
    });
    fireEvent.change(input, {
      target: { value: '¿Ya fue asignado?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    expect(await screen.findByText('Tu pedido ya fue asignado a una ruta.')).toBeTruthy();
    expect(
      screen.getByText('Se normaliza la pregunta y se comparte el estado básico del pedido.')
    ).toBeTruthy();
    const [statusUrl, statusOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(statusUrl).toBe('/api/cliente/chat/estado');
    expect(statusOptions.cache).toBe('no-store');
    const [url, options] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/cliente/chat');
    expect(options.cache).toBe('no-store');
    expect(JSON.parse(String(options.body))).toEqual({
      guide: 'private-tracking-guide',
      messages: [{ role: 'user', content: '¿Ya fue asignado?' }],
    });
  });

  it('discloses that an ETA is shared only for arrival questions', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    await screen.findByRole('textbox', { name: 'Escribe tu pregunta sobre el pedido' });
    const summary = screen.getByText(
      /a la IA solo se envían la intención normalizada y el estado del pedido/i
    );
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(
      screen.getByText(/si preguntas por la llegada, el ETA es aproximado/i)
    ).toBeTruthy();
    expect(
      screen.getByText(/TomTom, si está disponible, solo cubre parte del primer tramo/i)
    ).toBeTruthy();
    expect(screen.getByText(/el texto original no se comparte/i)).toBeTruthy();
    expect(
      screen.getByText(/no se envían guía, dirección, coordenadas, nombre, teléfono ni IDs/i)
    ).toBeTruthy();
  });

  it('shows the backend recovery message when the assistant is not configured', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            'El asistente no está configurado. Puedes seguir consultando el pedido con tu guía.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    const input = await screen.findByRole('textbox', {
      name: 'Escribe tu pregunta sobre el pedido',
    });
    fireEvent.change(input, {
      target: { value: '¿Ya viene?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('El asistente no está configurado');
    expect(alert.textContent).toContain('Puedes seguir consultando el pedido con tu guía.');
    expect((input as HTMLInputElement).value).toBe('¿Ya viene?');
  });

  it('restores the failed question and retries it without duplicating conversation history', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'El asistente tardó demasiado.' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reply: 'Tu pedido sigue pendiente de asignación.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    const input = await screen.findByRole('textbox', {
      name: 'Escribe tu pregunta sobre el pedido',
    });
    fireEvent.change(input, { target: { value: '¿Ya fue asignado?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'El asistente tardó demasiado.'
    );
    expect((input as HTMLInputElement).value).toBe('¿Ya fue asignado?');

    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    expect(await screen.findByText('Tu pedido sigue pendiente de asignación.')).toBeTruthy();
    const firstRequest = mockFetch.mock.calls[1]?.[1] as RequestInit;
    const retryRequest = mockFetch.mock.calls[2]?.[1] as RequestInit;
    expect(JSON.parse(String(firstRequest?.body)).messages).toEqual([
      { role: 'user', content: '¿Ya fue asignado?' },
    ]);
    expect(JSON.parse(String(retryRequest?.body)).messages).toEqual([
      { role: 'user', content: '¿Ya fue asignado?' },
    ]);
  });

  it('explains when the assistant is not configured and keeps its chat form hidden', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ configured: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    expect(
      await screen.findByText(
        'El asistente no está configurado por ahora. Puedes seguir consultando el estado del pedido y su ubicación con esta misma guía.'
      )
    ).toBeTruthy();
    expect(screen.getByText('IA sin configurar')).toBeTruthy();
    expect(
      screen.queryByRole('textbox', { name: 'Escribe tu pregunta sobre el pedido' })
    ).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows a chat attempt when the availability check itself fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('availability check failed')).mockResolvedValueOnce(
      new Response(JSON.stringify({ reply: 'Tu guía continúa en seguimiento.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    render(<CustomerOrderChat guide="private-tracking-guide" />);

    expect(
      await screen.findByText(
        'No pudimos confirmar si el asistente está configurado. Puedes intentar enviar tu pregunta.'
      )
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Escribe tu pregunta sobre el pedido' }), {
      target: { value: '¿Ya viene?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));

    expect(await screen.findByText('Tu guía continúa en seguimiento.')).toBeTruthy();
  });
});
