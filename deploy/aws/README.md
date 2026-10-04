# Despliegue local preparado para AWS

Esta carpeta contiene infraestructura como código; no ejecuta despliegues por
sí sola. El diseño mantiene tres componentes separados: Next.js (ECS/Fargate),
FastAPI (ECS/Fargate) y PostgreSQL (RDS). El navegador usa un único dominio:
el ALB envía `/api/*` a FastAPI y las demás rutas al frontend. La base de datos
queda en subredes privadas aisladas y no acepta conexiones desde Internet.

## Archivos

- `../../Dockerfile`: imagen de frontend Next.js con salida standalone.
- `../../backend/Dockerfile`: imagen FastAPI, Alembic y tarea de aprovisionamiento.
- `lib/rutas-pasto-stack.ts`: VPC, RDS, secretos, tareas/servicios ECS, ALB,
  controles de red y salidas necesarias para las tareas de base de datos.
- `scripts/run-database-task.sh`: ejecuta y espera una tarea Fargate puntual;
  sirve para inicializar el usuario de aplicación y correr Alembic.
- `cdk.json`, `package.json`, `pnpm-lock.yaml`: configuración y dependencias
  fijadas para sintetizar la infraestructura localmente.

La API y la UI se construyen como imágenes independientes. El frontend no recibe
credenciales ni se conecta a PostgreSQL. FastAPI lee las credenciales como
secretos ECS/Secrets Manager y verifica el certificado TLS de RDS. Las claves
opcionales (TomTom, Groq, ORS, SMTP y Twilio) se dejan vacías intencionalmente;
se añaden después al secreto `rutas-pasto/<entorno>/integrations`, nunca a Git ni
a argumentos de build.

## Preparación local

Requisitos: Node.js 22, pnpm 10, Docker con Buildx, AWS CLI autenticado, una
cuenta/región AWS y permisos para CDK, CloudFormation, IAM, ECS, ECR, EC2, RDS,
Secrets Manager, ACM y CloudWatch Logs. La región se elige al preparar el
despliegue; no está codificada en el proyecto.

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

## Secuencia de despliegue manual, cuando se autorice

1. Revisar costo y capacidad. El entorno `dev` usa una NAT y una instancia RDS
   pequeña; `prod` usa dos NAT, RDS Multi-AZ, backups más largos y protección
   contra borrado. NAT, ALB y RDS generan cargos mientras existan.
2. Para producción, solicitar y validar un certificado ACM en la región de la
   app antes del stack; `prod` rechaza la síntesis si no se pasa su ARN.
3. Ejecutar `cdk bootstrap` una vez por cuenta/región y desplegar con
   `servicesEnabled=false`. Así se crean primero red, RDS, secretos e imágenes
   ECS, pero los servicios web quedan con desired count cero.
4. Esperar a que RDS esté disponible. Obtener de las salidas del stack el
   nombre del cluster, task definitions, subredes privadas y security group
   FastAPI. Ejecutar `run-database-task.sh` primero con
   `DatabaseBootstrapTaskDefinitionArn` y después con
   `DatabaseMigrationTaskDefinitionArn`. El primer task crea el rol
   `rutas_app` con permisos acotados; el segundo aplica Alembic.
5. Si ambas tareas terminan con código cero, redesplegar el mismo entorno con
   `servicesEnabled=true`. La UI y la API arrancan como servicios separados.
   El backend queda inicialmente en una sola tarea: la cola FIFO de eventos GPS
   es por proceso, por lo que no se escala horizontalmente hasta añadir y
   verificar coordinación distribuida. El frontend sí puede tener dos tareas
   en producción.
6. Asociar el dominio al ALB y verificar HTTPS, health checks, `/api/health`,
   login, creación/optimización de pedido y la vista cliente antes de usar
   datos reales.

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
