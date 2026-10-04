# RUTAS-ENTREGAS-ESTRUCTURAS-DE-DATOS

## Optimizador de Rutas de Entrega — Pasto, Nariño

Sistema web para empresas de mensajería que optimiza rutas de reparto dentro de Pasto usando estructuras de datos clásicas (grafos, colas, pilas, heaps) sobre una red vial modelada como grafo.

## Stack Tecnológico

- **Framework:** Next.js 15 (App Router) + TypeScript (strict)
- **Backend:** Python 3.12+ + FastAPI + Pydantic
- **Persistencia:** PostgreSQL + SQLAlchemy 2 + Alembic
- **Mapas web:** MapLibre GL JS + OpenStreetMap
- **Ruteo:** OSRM (Table + Route), con ORS como adaptador alternativo
- **App iPhone:** SwiftUI + MapKit, consumiendo la misma API FastAPI
- **Estilos:** Tailwind CSS v4
- **Testing:** pytest/Ruff/mypy (backend), Vitest (UI) + Playwright (e2e)
- **Package managers:** uv (Python) + pnpm (frontend)
- **Git Hooks:** Husky + lint-staged

## Función principal y perfiles

El sistema centraliza entregas dentro de Pasto. El despachador registra
repartidores y pedidos, asigna pedidos, optimiza el orden de las paradas con
tiempos de la red vial y supervisa la ruta en el mapa oscuro de MapLibre con
el recorrido resaltado en verde. El repartidor inicia sesión, comparte su
posición durante el turno y ve su ruta y entregas pendientes. El cliente
consulta con su guía un único pedido, su estado y ETA aproximado sin recibir
datos privados del repartidor ni de otras entregas.

La geometría y los costos de ruta provienen de OSRM; TomTom puede ajustar
tramos muestreados cuando está configurado. Registro de pedidos, autenticación
por rol, ubicación GPS, recálculo/deshacer ruta, seguimiento, chat acotado,
analítica y avisos consentidos por correo/SMS viven en FastAPI. El frontend y
la API validan límites de Pasto; los secretos y la lógica que protege datos se
mantienen en el backend.

## Primeros Pasos

### 1. Requisitos previos

- Node.js 22.x LTS (fijado en `.nvmrc` y `package.json`)
- pnpm 10.34.5 (fijado en `package.json`)
- Docker Compose (PostgreSQL local)
- Python 3.12+ y uv

### 2. Configuración inicial

```bash
# Clonar e instalar dependencias
pnpm install
uv sync --project backend

# Copiar variables de entorno y editar
cp .env.example .env
# Editar .env con tus valores:
# - DATABASE_URL (apunta al PostgreSQL local)
# - AUTH_SECRET y DISPATCHER_ACCESS_CODE (valores privados, únicos)
# - OSRM_API_URL (por defecto usa el servicio público de demostración)

# Levantar PostgreSQL local
docker compose up -d

# Aplicar el baseline/migraciones con Alembic
pnpm db:migrate

# Iniciar frontend y API Python juntos
pnpm dev
```

`pnpm dev` inicia FastAPI en `127.0.0.1:8000` y Next.js en
`localhost:3000`. Next reenvía `/api/*` a FastAPI mediante
`PYTHON_API_URL`; para iniciar los procesos por separado usa `pnpm dev:api` y
`pnpm dev:web`. PostgreSQL debe estar saludable antes de probar operaciones de
pedidos, rutas o repartidores.

### App nativa para iPhone

El proyecto Xcode está en [`ios/RutasPasto.xcodeproj`](ios/RutasPasto.xcodeproj).
Ábrelo con Xcode 27, selecciona un simulador o un iPhone con firma de
desarrollo y ejecuta el esquema `RutasPasto`. La app permite buscar una guía,
ver el destino, el repartidor, la ruta verde y el ETA; actualiza el seguimiento
cada 10 segundos mientras la entrega está activa.

En la app abre ⚙ y configura la URL del backend:

- Pruebas en la misma red: `http://IP_DEL_PC:3000` (y API publicada/reenvíada).
- Uso por internet: la URL HTTPS pública donde esté desplegado Next.js.

El iPhone y el dashboard del PC comparten la misma API y base de datos. El
backend debe estar publicado con HTTPS para que el teléfono funcione fuera de
la red local; una IP `192.168.x.x` solo sirve para desarrollo en Wi-Fi.

### Acceso y operación

1. Configura `AUTH_SECRET` con al menos 32 bytes aleatorios y un
   `DISPATCHER_ACCESS_CODE` privado. No uses los valores de ejemplo en un
   despliegue.
2. En `/acceso`, ingresa con el código de despacho. Desde el dashboard registra
   cada repartidor y entrega su código de un solo uso por un canal privado.
3. El repartidor inicia sesión con ese código desde `/acceso`; su PWA identifica
   la cuenta por la sesión, no por un selector de nombres o un ID del navegador.
4. El GPS solo activa disponibilidad dentro de la zona de servicio de Pasto.
   Una lectura vence a los dos minutos; no se asignan rutas a una ubicación
   antigua. Los datos privados de ruta no se guardan para uso offline.
5. El cliente consulta únicamente con su guía en `/cliente`. Esa vista no
   entrega datos personales del repartidor ni la lista de otros pedidos.

El centro inicial del mapa usa `NEXT_PUBLIC_MAP_DEFAULT_LAT` y
`NEXT_PUBLIC_MAP_DEFAULT_LNG` solo si son coordenadas numéricas dentro de la
zona de servicio; si faltan o apuntan fuera de Pasto, se usa el centro seguro
documentado en `.env.example`.

### Ruteo y estimaciones

OSRM es el proveedor primario. La Matrix API entrega tiempos/distancias de la
red vial, `nearestNeighbor + twoOpt` decide el orden de visita y la Route API
devuelve la geometría real de calles que se dibuja en MapLibre. Si OSRM falla,
no se persiste ni se dibuja una línea recta haciéndola pasar por una ruta.
OpenRouteService se conserva como adaptador alternativo y su API key no es
necesaria para el flujo OSRM.

TomTom Traffic Flow es un complemento opcional de tráfico en vivo. Configura
`TOMTOM_API_KEY` solo en el entorno del backend (en desarrollo, `.env`; nunca
en variables `NEXT_PUBLIC_*`). Al crear o recalcular rutas, el backend consulta
hasta ocho puntos distribuidos sobre la geometría vial, aplica los factores de
tiempo de TomTom a esos tramos y deja el resto con la matriz de OSRM/ORS. La
respuesta incluye `liveTraffic` con cobertura, tramos ajustados/cerrados y
avisos. Sin clave, o si TomTom falla, se conserva la optimización vial base; el
endpoint autenticado `GET /api/traffic?lat=1.2136&lon=-77.2811` permite
consultar un segmento dentro de la zona de servicio de Pasto. La caché es en
memoria por proceso (TTL 90 s), no compartida entre réplicas.

El servicio público `router.project-osrm.org` es útil para desarrollo y
demostración, pero no ofrece SLA ni tráfico en vivo. Para operación comercial
se debe configurar una instancia OSRM administrada/self-hosted y validar
actualizaciones del extracto OpenStreetMap de Pasto. El ETA mostrado es una
estimación basada en tiempos viales; no debe presentarse como tráfico actual.

### Privacidad de IA externa

La integración de IA que procesa ubicaciones está desactivada para compartir
datos por defecto. Para habilitarla conscientemente, configura
`AI_ALLOW_LOCATION_DATA_SHARING=true` junto con las variables del proveedor.
Al activarla, el asesor de tráfico recibe coordenadas de repartidores y
destinos con alias temporales; el normalizador recibe la dirección de entrega
y sus coordenadas. No recibe nombres ni teléfonos. Revisa las condiciones de
retención del proveedor y comunica este tratamiento antes de usarlo con pedidos
reales. Con el valor `false`, se mantiene la normalización local y la
optimización determinista sin enviar esas ubicaciones a la IA.

### Asistente de preguntas sobre el pedido

FastAPI ofrece `POST /api/cliente/chat`, autorizado con la guía de seguimiento.
El adaptador usa el protocolo OpenAI Chat Completions. La configuración
predeterminada apunta a Groq con `openai/gpt-oss-20b`, un modelo de producción
de alta velocidad adecuado para preguntas breves del pedido; solo hace falta
agregar `CUSTOMER_CHAT_API_KEY` en el servidor. URL y modelo se pueden cambiar
por variables de entorno:

```dotenv
CUSTOMER_CHAT_API_URL=https://api.groq.com/openai/v1/chat/completions
CUSTOMER_CHAT_API_KEY=tu-clave-privada
CUSTOMER_CHAT_MODEL=openai/gpt-oss-20b
CUSTOMER_CHAT_TIMEOUT_MS=5000
```

La key nunca se expone al navegador. El texto libre original no se envía al
proveedor: el backend lo reduce a una de cuatro preguntas canónicas (estado,
asignación, avance del recorrido o ETA) y comparte esas intenciones junto con
el estado básico del pedido. Así, aunque el cliente escriba una guía,
dirección, coordenadas, nombre, teléfono o ID interno en el chat, ninguno
llega al proveedor. Solo cuando la pregunta es sobre el tiempo de llegada, el
backend añade los minutos estimados por la matriz vial para esa guía; nunca
comparte la ubicación que produjo el cálculo ni afirma que el ETA incluya
tráfico en vivo. El aviso previo explica que el ETA aproximado solo se comparte
al preguntar por la llegada. Si la señal está vencida o no hay conexión vial,
el asistente debe decir que no puede estimarlo, sin inventar una hora. El
endpoint limita el historial y no permite que el navegador invente respuestas
previas del bot. Si el proveedor demora, aplica rate limit o devuelve un error,
FastAPI contesta con una respuesta determinista basada solo en el estado del
pedido y, cuando existe, el ETA ya calculado; indica que es un respaldo y no
inventa ubicación ni hora de llegada. Sin configuración completa, el
seguimiento normal sigue disponible y el chat informa que la IA no está
configurada. En `/cliente`, el cliente puede abrir
el chat después de consultar una guía; el aviso sobre el uso del proveedor se
muestra antes de enviar la primera pregunta y el historial enviado contiene
solo turnos escritos por el cliente.

El endpoint limita el cuerpo a 16 KiB y permite hasta 12 consultas por guía en
una ventana de 60 segundos. El contador se guarda como HMAC de la guía en
PostgreSQL, por lo que todas las réplicas FastAPI comparten el mismo límite y
la tabla no contiene el token en claro. Las ventanas antiguas se limpian de
forma periódica; si PostgreSQL no puede aplicar el límite, el chat falla con
`503` antes de consumir la API de IA. El endpoint responde `413` o `429` con
`Retry-After` cuando corresponde.

### Avisos privados al cliente

Al crear un pedido, el formulario permite dar consentimiento independiente para
avisos por correo y SMS. Sin consentimiento de un canal, el frontend omite su
contacto y el backend no lo guarda; ambos consentimientos están apagados por
defecto. El correo o SMS solo avisa cuando se asigna el pedido y cuando el GPS
aceptado del repartidor entra en un radio aproximado de 500 m del siguiente
punto de entrega activo. Ese radio no es una predicción de llegada: las
pendientes y calles estrechas de Pasto hacen que la distancia recta no sea un
ETA fiable. Los mensajes no incluyen datos del repartidor, dirección ni
coordenadas, ni la referencia interna del pedido. Los contactos tampoco se
exponen en las respuestas HTTP.

Los eventos se guardan en `customer_notification_outbox` dentro de la misma
transacción que asigna la ruta o registra la ubicación. Una clave única evita
duplicar el mismo aviso; el envío ocurre después del commit, se reintenta con
espera incremental y el contenido/destinatario se elimina al confirmar el
envío. Los errores persistidos guardan solo el tipo de excepción. Los reintentos
los puede procesar un worker de FastAPI cada 30 segundos (ajustable con
`CUSTOMER_NOTIFICATION_POLL_SECONDS`) solo si `CUSTOMER_NOTIFICATION_WORKER_ENABLED=true`
y corre en un servidor persistente. Por defecto está deshabilitado para evitar
iniciar un poller infinito en un runtime serverless; además, FastAPI ignora la
bandera cuando detecta `VERCEL=1`, como protección si se ejecuta allí. En el
despliegue AWS preparado, el worker corre dentro del servicio FastAPI persistente.
Los avisos nuevos se
despachan como tarea ligada a la solicitud de asignación o al reporte GPS que
los genera; si falla el proveedor, quedan en la outbox para reintento cuando
llegue otra solicitud o cuando se habilite el worker persistente. En un entorno
sin tráfico posterior no hay reintento periódico automático, y el dashboard
muestra los pendientes/fallidos. Las instancias coordinan la toma de avisos con
leases en PostgreSQL. La entrega es _at-least-once_: si el proveedor acepta un
mensaje y el proceso cae antes de marcarlo como enviado, el aviso podría
duplicarse. Para correo, configura un relay SMTP:

```dotenv
NOTIFICATION_SMTP_HOST=smtp.example.com
NOTIFICATION_SMTP_PORT=587
NOTIFICATION_SMTP_USERNAME=usuario
NOTIFICATION_SMTP_PASSWORD=secreto
NOTIFICATION_FROM_EMAIL=notificaciones@example.com
NOTIFICATION_SMTP_TIMEOUT_MS=5000
```

Para SMS, configura una cuenta Twilio y su remitente en formato E.164:

```dotenv
NOTIFICATION_SMS_TWILIO_ACCOUNT_SID=AC...
NOTIFICATION_SMS_TWILIO_AUTH_TOKEN=secreto
NOTIFICATION_SMS_TWILIO_FROM_PHONE=+1...
NOTIFICATION_SMS_TIMEOUT_MS=5000
```

Cada canal se entrega solo si el cliente lo autorizó y su proveedor está
configurado. Si falta SMTP o Twilio, los eventos de ese canal quedan pendientes
y el dashboard avisa al despachador; no se simula una entrega. Configura las
credenciales como secretos del backend (en producción, en el entorno de
despliegue), nunca en el navegador ni en Git.

### Deshacer el último recálculo

En una ruta planificada o en curso, el despachador puede restaurar el último
orden optimizado desde su resumen. Cada recálculo guarda en PostgreSQL una
revisión atómica con las métricas, geometría y secuencia anterior; la pila
LIFO se reconstruye desde esas revisiones, por lo que funciona tras un reinicio
o en otra réplica. Se conservan como máximo 20 revisiones por ruta. Si una
parada anterior ya se entregó o una parada nueva ya inició su entrega, el
backend rechaza el deshacer para no contradecir el progreso real. Al deshacer
una parada añadida por el recálculo, vuelve a la cola de pedidos pendientes.

### Recorrido corto para una demostración

1. Inicia el stack local con los pasos de configuración inicial e ingresa en
   `/acceso` con el código de despacho.
2. En el dashboard registra un repartidor y entrega su código de un solo uso
   por un canal privado. Inicia otra sesión de navegador en `/acceso` con ese
   código y permite el GPS en una ubicación de prueba dentro de Pasto.
3. En `/pedidos`, selecciona en el mapa una ubicación de prueba en Pasto. Si
   quieres demostrar notificaciones por ambos canales, introduce contactos de
   prueba y activa explícitamente el consentimiento de correo y SMS; para
   recibirlos de verdad, SMTP y Twilio deben estar configurados en el backend.
   Conserva la guía que aparece al registrar el pedido.
4. Vuelve al dashboard, selecciona el repartidor y el pedido, pulsa analizar y
   luego despachar. Revisa en el mapa el trazado vial verde y el orden de
   paradas. La interfaz informa si los avisos quedaron en cola o si falta
   configurar algún proveedor.
5. En `/cliente`, consulta la guía. Para ver un aviso de cercanía, el GPS del
   repartidor debe reportar una posición aceptada dentro del radio aproximado
   del siguiente destino; no se generan avisos de prueba fingiendo una entrega.

Usa datos y contactos sintéticos durante la presentación. No compartas una guía
real ni actives consentimientos de clientes reales como parte de una demo.

## Scripts Disponibles

```bash
pnpm dev              # FastAPI + Next.js (http://localhost:3000)
pnpm dev:api          # Solo FastAPI (http://127.0.0.1:8000)
pnpm dev:web          # Solo Next.js
pnpm build            # Build de producción
pnpm start            # Servidor de producción
pnpm typecheck        # Verificación de tipos TypeScript
pnpm lint             # Linting con ESLint
pnpm test             # Tests unitarios de utilidades de interfaz (Vitest)
pnpm test:watch       # Tests en modo watch
pnpm test:e2e         # Tests e2e (Playwright)
pnpm test:e2e:ui      # Playwright UI mode
pnpm test:backend
pnpm lint:backend
pnpm typecheck:backend
pnpm db:migrate
pnpm db:preflight
```

Los comandos `*:backend` y `db:*` usan uv desde `backend/`, aunque se invoquen
en la raíz del repositorio.

FastAPI es la única implementación de /api/*; Next.js reenvía esas rutas al
servicio Python y conserva únicamente páginas, componentes y estado de
interfaz. SQLAlchemy y Alembic son la única capa de persistencia y migraciones.
El baseline conserva los datos existentes y también crea el schema al
inicializar una base vacía.

Para ejecutar e2e con puertos separados del servidor de desarrollo:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 PYTHON_API_PORT=8002 pnpm test:e2e.

## Estructura del Proyecto

```
src/
  app/                    # Next.js App Router: páginas y presentación
  components/             # Componentes TypeScript y MapLibre
backend/
  app/api/                # Endpoints FastAPI /api/*
  app/core/
    structures/           # Queue, Stack, MinHeap, listas simple y doble
    graph/                # Grafo dirigido, Dijkstra y A*
    optimization/         # Asignación, nearest neighbor y 2-opt
    routing/              # OSRM/ORS, contratos, geometría y cachés
    traffic/              # TomTom, map matching y factores de congestión
    metrics/              # ETA y métricas de ruta
  app/models/             # Modelos SQLAlchemy
  app/schemas/            # Contratos Pydantic
  app/services/           # Casos de uso
  app/repositories/       # Consultas y acceso a persistencia
  alembic/                # Migraciones Python
  scripts/                # Preflight y bootstrap controlado de DB
  tests/                  # pytest unitario y de API
deploy/aws/               # CDK, ECS Express/RDS y tareas puntuales de DB
docs/                     # Arquitectura y decisiones operativas
ios/                      # App nativa SwiftUI para repartidores
tests/e2e/                # Playwright
```

### Dónde se aplican las estructuras de datos

Las implementaciones son nativas de Python, sin librerías de estructuras de
datos. `backend/app/core` se mantiene independiente de FastAPI, SQLAlchemy y la
UI. Las estructuras tienen pruebas unitarias en `backend/tests`.

| Estructura                        | Uso concreto                                                                                                                                                    | Archivos principales                                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lista simplemente enlazada        | Base propia para las operaciones de extremos O(1) de las estructuras lineales.                                                                                  | [`singly_linked_list.py`](backend/app/core/structures/singly_linked_list.py)                                                                                                                                     |
| Cola FIFO                         | `LocationEventQueue` serializa eventos GPS dentro de un proceso FastAPI y aplica backpressure antes de persistirlos. No es una cola distribuida entre réplicas. | [`queue.py`](backend/app/core/structures/queue.py), [`location_event_queue.py`](backend/app/services/location_event_queue.py)                                                                                    |
| Pila LIFO                         | Mantiene revisiones de ruta para deshacer el recálculo más reciente, respaldada por snapshots en PostgreSQL.                                                    | [`stack.py`](backend/app/core/structures/stack.py), [`route_planner.py`](backend/app/services/route_planner.py)                                                                                                  |
| Heap mínimo indexado              | Dijkstra y A* extraen la distancia/prioridad menor y actualizan claves por ID estable.                                                                          | [`min_heap.py`](backend/app/core/structures/min_heap.py), [`dijkstra.py`](backend/app/core/graph/dijkstra.py), [`astar.py`](backend/app/core/graph/astar.py)                                                     |
| Grafo dirigido y ponderado        | Núcleo académico de caminos mínimos. No reemplaza el grafo vial real: las calles, restricciones y geometría de producción las entrega OSRM.                     | [`graph.py`](backend/app/core/graph/graph.py), [`path.py`](backend/app/core/graph/path.py)                                                                                                                       |
| Vecino más cercano + 2-opt        | Ordena paradas usando la matriz de tiempos de OSRM; 2-opt prueba reversiones para reducir el costo del recorrido abierto.                                       | [`nearest_neighbor.py`](backend/app/core/optimization/nearest_neighbor.py), [`two_opt.py`](backend/app/core/optimization/two_opt.py)                                                                             |
| Lista doblemente enlazada         | Cachés LRU de matrices OSRM y segmentos TomTom; referencias a nodos permiten mover/retirar un elemento conocido en O(1).                                        | [`doubly_linked_list.py`](backend/app/core/structures/doubly_linked_list.py), [`cached_matrix_provider.py`](backend/app/core/routing/cached_matrix_provider.py), [`traffic.py`](backend/app/services/traffic.py) |
| Asignación por cercanía y balance | Agrupa pedidos entre repartidores disponibles antes de optimizar por calles cada recorrido.                                                                     | [`assign_orders.py`](backend/app/core/optimization/assign_orders.py)                                                                                                                                             |

El grafo propio, Dijkstra y A* demuestran los algoritmos del núcleo; el
producto no presenta sus aristas abstractas como calles. Los costos productivos
son tiempos de red vial de OSRM, con ajustes opcionales solo en tramos muestreados
de tráfico. La ruta dibujada usa geometría vial, no segmentos rectos.

Regla de arquitectura: `backend/app/core` no importa FastAPI, SQLAlchemy ni la
UI. Los commits del equipo se escriben en español, modo imperativo, por
ejemplo: `"agrega heap binario para dijkstra"`.

Para explicar el flujo funcional y el uso real de las estructuras, consulta la
[vista de arquitectura](docs/arquitectura.md).

## Verificación de Calidad (Definition of Done)

Antes de cualquier PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm typecheck:backend
pnpm lint:backend
pnpm test:backend
pnpm db:migrate
pnpm build
pnpm test:e2e    # requiere PostgreSQL y el backend Python
```

El workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) está
configurado para ejecutar esta secuencia en cada pull request y en cada push
a `main`, usando PostgreSQL 16, Node.js 22 y OSRM simulado para los E2E. La
IA externa permanece desactivada en CI; las pruebas no transmiten ubicaciones
reales a un proveedor.

## Despliegue

- **Frontend:** Next.js 15 en Vercel, con el dominio HTTPS `*.vercel.app`.
- **Backend:** FastAPI en ECS Express Mode (Fargate), con endpoint HTTPS de AWS.
  Next.js hace proxy de `/api/*` desde el mismo dominio de Vercel mediante
  `PYTHON_API_URL`; el navegador no llama directamente a AWS.
- **Base de datos:** PostgreSQL en RDS, cifrada y en subredes privadas aisladas;
  solo FastAPI puede abrir el puerto PostgreSQL.
- **Migraciones:** tarea Fargate puntual Alembic; no se ejecutan durante el build.

Los archivos de preparación están en [`deploy/aws/README.md`](deploy/aws/README.md):
Dockerfile del backend, CDK, secretos de Secrets Manager, bootstrap del rol de
base de datos y tarea de migraciones. La salida `standalone` de Next se conserva
para contenedores locales, aunque producción sirve el frontend desde Vercel.
ECS Express Mode administra el endpoint HTTPS del backend; no se necesita
comprar un dominio propio para conectar Vercel con AWS.

Las credenciales `AUTH_SECRET`, `DISPATCHER_ACCESS_CODE`, base de datos y
proveedores externos son exclusivas del backend y se guardan en AWS Secrets
Manager. Vercel recibe únicamente el origen público no secreto `PYTHON_API_URL`
y las variables públicas del mapa. RDS sigue privado y FastAPI verifica su TLS
con `verify-full` y el bundle CA.

El backend se mantiene en una tarea porque la cola FIFO de eventos GPS y el
worker de notificaciones son locales al proceso. No se escala horizontalmente
hasta coordinar esos consumidores. La infraestructura todavía requiere revisar
cuenta/región, costo y `cdk diff` antes de crear o modificar recursos; las
migraciones y el flujo end-to-end se verifican antes de operar con pedidos reales.

## Licencia

Proyecto interno — todos los derechos reservados.
