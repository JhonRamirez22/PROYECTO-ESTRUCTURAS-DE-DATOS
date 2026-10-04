import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface ServiceWorkerEvent {
  request?: Request;
  respondWith?: (response: Promise<unknown>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
}

type ServiceWorkerListener = (event: ServiceWorkerEvent) => void;

const serviceWorkerSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

describe('service worker', () => {
  it('solo elimina cachés antiguas de Rutas Pasto', async () => {
    const { deletedCaches, listeners } = loadServiceWorker([
      'rutas-pasto-shell-v2',
      'rutas-pasto-map-v1',
      'other-app-shell-v1',
    ]);
    let activation: Promise<unknown> | undefined;

    listeners.get('activate')?.({
      waitUntil: (promise) => {
        activation = promise;
      },
    });
    await activation;

    expect(deletedCaches).toEqual(['rutas-pasto-shell-v2']);
  });

  it('deja las respuestas de API fuera de Cache Storage', () => {
    const { listeners } = loadServiceWorker([]);
    let intercepted = false;

    listeners.get('fetch')?.({
      request: new Request('https://rutas-pasto.test/api/rutas'),
      respondWith: () => {
        intercepted = true;
      },
    });

    expect(intercepted).toBe(false);
  });
});

function loadServiceWorker(cacheNames: string[]): {
  deletedCaches: string[];
  listeners: Map<string, ServiceWorkerListener>;
} {
  const listeners = new Map<string, ServiceWorkerListener>();
  const deletedCaches: string[] = [];

  runInNewContext(serviceWorkerSource, {
    caches: {
      delete: async (name: string) => {
        deletedCaches.push(name);
        return true;
      },
      keys: async () => cacheNames,
      match: async () => undefined,
      open: async () => ({ add: async () => undefined }),
    },
    fetch,
    self: {
      addEventListener: (name: string, listener: ServiceWorkerListener) => {
        listeners.set(name, listener);
      },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
    },
    URL,
  });

  return { deletedCaches, listeners };
}
