import Link from 'next/link';
import AppShell from '@/components/AppShell';

export default function Home() {
  return (
    <AppShell active="home">
      <main className="px-4 py-6 sm:px-8 sm:py-10 lg:py-14">
        <section className="mx-auto max-w-6xl">
          <div className="overflow-hidden rounded-[2rem] border border-[#25453d] bg-[#122522] text-white shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
            <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
              <div className="px-5 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
                <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                  Del pedido pendiente a la puerta, sin perder el hilo.
                </h1>
                <p className="mt-5 max-w-[66ch] text-base leading-7 text-slate-200 sm:text-lg">
                  Registra pedidos, selecciona repartidores, calcula el orden de visita con tiempos
                  de calle y sigue el avance desde Pasto.
                </p>
                <p className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-emerald-100">
                  <span aria-hidden="true" className="rp-status-dot" />
                  Servicio local en Pasto, Nariño
                </p>
              </div>

              <section
                aria-labelledby="home-actions-title"
                className="border-t border-white/10 bg-[#0d1e1b]/70 p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-9"
              >
                <h2 className="text-lg font-semibold text-white" id="home-actions-title">
                  ¿Qué necesitas hacer?
                </h2>
                <div className="mt-4 space-y-3">
                  <HomeAction
                    description="Acceso privado para reparto y despacho."
                    href="/acceso"
                    title="Soy repartidor o despachador"
                    tone="primary"
                  />
                  <HomeAction
                    description="Consulta el avance de tu envío con la guía."
                    href="/cliente"
                    title="Soy cliente"
                    tone="secondary"
                  />
                </div>
              </section>
            </div>
          </div>

          <section aria-label="Cómo funciona el seguimiento" className="mt-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <h2 className="max-w-xl text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                Operación privada; seguimiento por guía
              </h2>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                La operación y el seguimiento están conectados por la misma guía del pedido.
              </p>
            </div>
            <dl className="mt-5 grid divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Feature
                label="Rutas por calles"
                value="Orden de visita optimizado con tiempos viales de OSRM."
              />
              <Feature
                label="Ubicación del equipo"
                value="El repartidor comparte su posición desde el GPS del teléfono."
              />
              <Feature
                label="Consulta para clientes"
                value="El estado, el recorrido y la llegada aproximada se consultan con la guía."
              />
            </dl>
          </section>

          <section
            aria-labelledby="route-method-title"
            className="mt-10 overflow-hidden rounded-[2rem] border border-[#25453d] bg-[#122522] text-white shadow-[0_18px_48px_rgba(15,23,42,0.14)]"
          >
            <div className="grid gap-7 px-5 py-7 sm:px-9 sm:py-9 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-12 lg:px-12 lg:py-11">
              <div>
                <h2
                  className="max-w-lg text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
                  id="route-method-title"
                >
                  Rutas por calles, con un orden que se puede explicar.
                </h2>
                <p className="mt-3 max-w-[56ch] text-sm leading-6 text-slate-200">
                  La optimización compara tiempos de la red vial; no conecta las direcciones con
                  líneas rectas ni promete un óptimo matemático.
                </p>
                <div className="mt-6 border-t border-white/15 pt-5">
                  <h3 className="text-sm font-semibold text-emerald-200">
                    Tráfico con alcance claro
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-200">
                    Si TomTom entrega una señal confiable, se ajustan solo segmentos muestreados.
                    Cuando no hay señal válida, se conserva el tiempo base de OSRM.
                  </p>
                </div>
              </div>

              <ol className="divide-y divide-white/15 border-y border-white/15">
                <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4 first:pt-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <span
                    aria-hidden="true"
                    className="pt-0.5 font-mono text-sm font-semibold text-emerald-300"
                  >
                    01
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Tiempos de la red vial</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-200">
                      OSRM calcula duraciones por calles y el backend las normaliza a minutos.
                    </p>
                  </div>
                </li>
                <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <span
                    aria-hidden="true"
                    className="pt-0.5 font-mono text-sm font-semibold text-emerald-300"
                  >
                    02
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Orden inicial con vecino más cercano
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-200">
                      Desde la ubicación del repartidor, el algoritmo elige la siguiente parada de
                      menor costo pendiente.
                    </p>
                  </div>
                </li>
                <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4 last:pb-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <span
                    aria-hidden="true"
                    className="pt-0.5 font-mono text-sm font-semibold text-emerald-300"
                  >
                    03
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Mejora local con 2-opt</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-200">
                      Prueba reordenar grupos de paradas para bajar el costo del recorrido abierto;
                      es una heurística, no una garantía de óptimo.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="border-t border-white/15 bg-black/10 px-5 py-4 sm:px-9 lg:px-12">
              <p className="max-w-5xl text-xs leading-5 text-slate-200">
                <span className="font-semibold text-emerald-200">Núcleo Python:</span> grafo
                dirigido y min-heap para Dijkstra/A*; cola enlazada para eventos GPS, pila para
                snapshots de recálculo y listas dobles para cachés LRU. La geometría dibujada viene
                del proveedor vial (OSRM por defecto).
              </p>
            </div>
          </section>

          <section
            aria-labelledby="customer-updates-title"
            className="mt-8 border-y border-slate-200 py-6 sm:py-8"
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-12">
              <div>
                <h2
                  className="max-w-lg text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl"
                  id="customer-updates-title"
                >
                  Información útil, ligada a tu pedido
                </h2>
                <p className="mt-2 max-w-[58ch] text-sm leading-6 text-slate-600">
                  La guía permite consultar el avance sin publicar datos del cliente ni del
                  repartidor.
                </p>
              </div>
              <dl className="divide-y divide-slate-200">
                <div className="grid gap-1 py-4 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm font-semibold text-slate-900">Asistente del pedido</dt>
                  <dd className="text-sm leading-6 text-slate-600">
                    Responde dudas sobre estado, asignación, recorrido o ETA. La consulta se
                    normaliza antes de llegar al proveedor de IA; no se envía el texto libre
                    original.
                  </dd>
                </div>
                <div className="grid gap-1 py-4 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm font-semibold text-slate-900">Avisos opcionales</dt>
                  <dd className="text-sm leading-6 text-slate-600">
                    El cliente puede autorizar correo, SMS o ambos para recibir avisos de asignación
                    y cercanía. Cada canal requiere estar configurado por la empresa.
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <div className="mt-6 flex flex-col gap-2 text-xs leading-5 text-slate-600 sm:flex-row sm:justify-between sm:gap-8">
            <p>
              El ETA es aproximado: usa la última posición GPS y los tiempos viales, y puede
              incorporar observaciones TomTom solo para el primer tramo cuando estén disponibles.
            </p>
            <p className="sm:max-w-md sm:text-right">
              En iPhone, abre esta página en Safari, pulsa Compartir y elige “Añadir a pantalla de
              inicio”.
            </p>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-4 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-sm font-semibold text-slate-900">{label}</dt>
      <dd className="mt-1 max-w-[38ch] text-sm leading-6 text-slate-600">{value}</dd>
    </div>
  );
}

function HomeAction({
  description,
  href,
  title,
  tone,
}: {
  description: string;
  href: string;
  title: string;
  tone: 'primary' | 'secondary';
}) {
  const styles =
    tone === 'primary'
      ? 'border-emerald-300 bg-emerald-300 text-[#10231f] hover:bg-emerald-200'
      : 'border-white/15 bg-white/[0.04] text-white hover:border-emerald-200/50 hover:bg-white/[0.08]';

  return (
    <Link
      className={`group block min-h-11 rounded-2xl border p-4 transition-colors duration-200 focus-visible:outline-offset-4 ${styles}`}
      href={href}
    >
      <span className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-bold">{title}</span>
          <span
            className={`mt-1 block text-xs leading-5 ${tone === 'primary' ? 'text-emerald-950/80' : 'text-slate-300'}`}
          >
            {description}
          </span>
        </span>
        <svg
          aria-hidden="true"
          className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M5 12h14m-6-6 6 6-6 6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </span>
    </Link>
  );
}
