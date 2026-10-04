export default function RoutingMethodology() {
  return (
    <details
      aria-label="Método de optimización y estructuras de datos"
      className="group mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 outline-offset-4 marker:hidden focus-visible:outline-2 focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Cómo se calcula el despacho
          </span>
          <span className="mt-1 block text-xs text-slate-600">
            Algoritmos, datos viales y alcance del asistente
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-emerald-900 group-open:bg-emerald-50">
          Ver método
        </span>
      </summary>

      <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Asignación
          </p>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">Cercanía y balanceo</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            El backend reparte los pedidos entre los repartidores elegidos según proximidad y carga.
            Los factores externos solo se aplican tras validación; si fallan, continúa el cálculo
            determinista.
          </p>
        </article>

        <article className="rounded-xl bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Orden de paradas
          </p>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">Nearest neighbor + 2-opt</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            La matriz de tiempos viales guía un orden inicial; 2-opt prueba mejoras. Es una
            heurística rápida para un recorrido abierto, no una garantía de óptimo matemático ni un
            regreso al origen.
          </p>
        </article>

        <article className="rounded-xl bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Calles y tráfico
          </p>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">OSRM + señal TomTom</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            OSRM aporta geometría vial y tiempos base. TomTom solo ajusta los segmentos muestreados
            con datos confiables; no representa tráfico en todas las calles de Pasto.
          </p>
        </article>

        <article className="rounded-xl bg-slate-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Núcleo de grafos
          </p>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">Grafo dirigido + min-heap</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            El backend implementa Dijkstra sobre el grafo dirigido y su heap binario. Esas
            estructuras no sustituyen al motor OSRM que calcula las calles mostradas en producción.
          </p>
        </article>
      </div>

      <div className="grid gap-3 border-t border-slate-100 px-4 py-4 sm:grid-cols-2">
        <section>
          <h3 className="text-xs font-semibold text-slate-800">Estructuras en servicios activos</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Una cola FIFO respaldada por lista enlazada serializa escrituras GPS con control de
            presión. Listas doblemente enlazadas sostienen cachés LRU de matrices y tráfico. La pila
            restaura en orden LIFO hasta 20 recálculos persistidos por ruta; el despachador puede
            deshacer el último mientras la ruta siga activa.
          </p>
        </section>
        <section>
          <h3 className="text-xs font-semibold text-slate-800">Seguimiento y avisos al cliente</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            El chat requiere la guía y solo responde sobre ese pedido; la API key vive en FastAPI.
            Los avisos de asignación y cercanía requieren consentimiento y un canal configurado, y
            pasan por una outbox con reintentos.
          </p>
        </section>
      </div>
    </details>
  );
}
