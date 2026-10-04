#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Ejecuta una tarea puntual de inicialización/migración en las subredes privadas ECS.

Uso:
  run-database-task.sh \
    --cluster CLUSTER \
    --task-definition TASK_DEFINITION_ARN \
    --subnets subnet-aaa,subnet-bbb \
    --security-group sg-aaa \
    --region us-east-1

Ejemplos de task definition: las salidas DatabaseBootstrapTaskDefinitionArn
y DatabaseMigrationTaskDefinitionArn del stack CDK.
USAGE
}

cluster=''
task_definition=''
subnets=''
security_group=''
region=''

while (($#)); do
  case "$1" in
    --cluster)
      cluster="${2:?Falta el valor de --cluster}"
      shift 2
      ;;
    --task-definition)
      task_definition="${2:?Falta el valor de --task-definition}"
      shift 2
      ;;
    --subnets)
      subnets="${2:?Falta el valor de --subnets}"
      shift 2
      ;;
    --security-group)
      security_group="${2:?Falta el valor de --security-group}"
      shift 2
      ;;
    --region)
      region="${2:?Falta el valor de --region}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Argumento desconocido: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$cluster" || -z "$task_definition" || -z "$subnets" || -z "$security_group" || -z "$region" ]]; then
  usage >&2
  exit 2
fi

network_configuration="awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}"
task_arn="$(aws ecs run-task \
  --region "$region" \
  --cluster "$cluster" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "$network_configuration" \
  --query 'tasks[0].taskArn' \
  --output text)"

if [[ -z "$task_arn" || "$task_arn" == 'None' ]]; then
  printf 'ECS no devolvió una tarea; revisa los fallos de run-task y los permisos IAM.\n' >&2
  exit 1
fi

printf 'Esperando tarea %s\n' "$task_arn"
aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task_arn"
aws ecs describe-tasks \
  --region "$region" \
  --cluster "$cluster" \
  --tasks "$task_arn" \
  --query 'tasks[0].{status:lastStatus,exitCode:containers[0].exitCode,stoppedReason:stoppedReason}' \
  --output table

exit_code="$(aws ecs describe-tasks \
  --region "$region" \
  --cluster "$cluster" \
  --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)"

if [[ "$exit_code" != '0' ]]; then
  printf 'La tarea terminó con exit code %s. Revisa CloudWatch Logs para el detalle.\n' "$exit_code" >&2
  exit 1
fi
