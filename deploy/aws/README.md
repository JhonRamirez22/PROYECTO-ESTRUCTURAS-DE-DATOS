# Despliegue local preparado para AWS

Esta carpeta contiene infraestructura como código; no ejecuta despliegues por
sí sola. El frontend Next.js se sirve desde Vercel; AWS aloja FastAPI en ECS
Express Mode (Fargate) y PostgreSQL en RDS. Vercel mantiene el dominio visible y
proxya `/api/*` al endpoint HTTPS de AWS mediante `PYTHON_API_URL`. La base de
datos queda en subredes privadas aisladas y no acepta conexiones desde Internet.

## Archivos

- `../../backend/Dockerfile`: imagen FastAPI, Alembic y tarea de aprovisionamiento.
- `lib/rutas-pasto-stack.ts`: VPC, RDS, secretos, tareas ECS, endpoint HTTPS ECS Express,
  controles de red y salidas necesarias para las tareas de base de datos.
- `scripts/run-database-task.sh`: ejecuta y espera una tarea Fargate puntual;
  sirve para inicializar el usuario de aplicación y correr Alembic.
- `cdk.json`, `package.json`, `pnpm-lock.yaml`: configuración y dependencias
  fijadas para sintetizar la infraestructura localmente.

Solo se construye la imagen backend en AWS. El frontend Vercel no recibe
credenciales privadas ni se conecta a PostgreSQL. FastAPI lee credenciales como
secretos ECS/Secrets Manager y verifica el certificado TLS de RDS. Las claves
opcionales (TomTom, Groq, ORS, SMTP y Twilio) se dejan vacías intencionalmente;
se añaden después al secreto `rutas-pasto/<entorno>/integrations`, nunca a Git ni
a argumentos de build. ECS Express Mode entrega al backend una URL HTTPS propia,
que se configura como `PYTHON_API_URL` en Vercel.

## Preparación local

Requisitos: Node.js 22, pnpm 10, Docker con Buildx, sesión AWS válida mediante
el MCP conectado a la cuenta correcta, región y permisos para CDK,
CloudFormation, IAM, ECS, ECR, EC2, RDS, Secrets Manager y CloudWatch Logs.
La región se elige al preparar el despliegue; no está codificada en el proyecto.

Desde la raíz del repositorio:

```bash
pnpm --dir deploy/aws install --frozen-lockfile
pnpm --dir deploy/aws typecheck
pnpm --dir deploy/aws synth
```

`synth` solo genera la plantilla local en `deploy/aws/cdk.out`; no crea ni
modifica recursos AWS. Los comandos `cdk bootstrap` y `cdk deploy` son pasos
futuros que requieren autorización explícita y no se ejecutan como parte de la
preparación local.

## Secuencia de despliegue, cuando haya credenciales AWS válidas

1. Confirmar cuenta, región, costo previsto y estado de cualquier stack o base
   existente. Revisar `cdk diff`; no aceptar reemplazos de RDS/VPC sin revisar
   la retención de datos.
2. Ejecutar `cdk bootstrap` una vez por cuenta/región y desplegar con
   `servicesEnabled=false`. Se crean red, RDS, secretos y las tareas de DB,
   pero no se publica el backend todavía.
3. Esperar a que RDS esté disponible. Obtener de las salidas del stack el
   nombre del cluster, task definitions, subredes privadas y security group
   FastAPI. Ejecutar `run-database-task.sh` primero con
   `DatabaseBootstrapTaskDefinitionArn` y después con
   `DatabaseMigrationTaskDefinitionArn`. El primer task crea el rol
   `rutas_app` con permisos acotados; el segundo aplica Alembic.
4. Si ambas tareas terminan con código cero, redesplegar el mismo entorno con
   `servicesEnabled=true`. ECS Express crea el backend con endpoint HTTPS
   administrado. Se mantiene una sola tarea porque la cola FIFO de eventos GPS
   y el worker de notificaciones son locales al proceso.
6. Añadir `PYTHON_API_URL` a las variables de producción y preview de Vercel con
   el endpoint de salida `BackendUrl`, y publicar el frontend desde el proyecto
   Vercel conectado. No copiar secretos AWS a Vercel.
7. Verificar `/api/health`, login, creación/optimización de pedido y seguimiento
   desde el dominio Vercel antes de usar datos reales.

El valor del código de despacho se genera en Secrets Manager. El stack solo
expone el nombre del secreto, nunca su valor. Cargar integraciones externas
después de desplegar el stack; no pasar claves en la terminal, plantillas,
Docker build args ni variables `NEXT_PUBLIC_*`.

## Conexión RDS

La app consume `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`,
`DATABASE_USERNAME` y `DATABASE_PASSWORD` por separado. `DATABASE_URL` queda
sin definir en ECS para no concatenar secretos ni imprimirlos durante una
migración. La imagen Python incluye el bundle público de CA de RDS y usa
`DATABASE_SSL_MODE=verify-full` junto al hostname real de la instancia.

La tarea puntual se ejecuta desde una estación con AWS CLI y permisos IAM para
`ecs:RunTask`, `ecs:DescribeTasks`, `iam:PassRole` y espera de tareas. Ejemplo
con valores tomados de outputs del stack (no usar literalmente los marcadores):

```bash
./deploy/aws/scripts/run-database-task.sh \
  --cluster <EcsClusterName> \
  --task-definition <DatabaseBootstrapTaskDefinitionArn> \
  --subnets <PrivateSubnetIds separados por coma> \
  --security-group <BackendSecurityGroupId> \
  --region <region>
```

Repetir con `<DatabaseMigrationTaskDefinitionArn>` tras éxito del bootstrap.
El script solo lanza la tarea al invocarlo; nunca se ejecutó en esta preparación.
