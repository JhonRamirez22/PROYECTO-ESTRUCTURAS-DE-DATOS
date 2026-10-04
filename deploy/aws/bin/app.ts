import * as cdk from 'aws-cdk-lib';
import { RutasPastoStack } from '../lib/rutas-pasto-stack';

const app = new cdk.App();
const environmentName = String(app.node.tryGetContext('environment') ?? 'dev');
const servicesEnabled = String(app.node.tryGetContext('servicesEnabled') ?? 'false') === 'true';

if (!['dev', 'prod'].includes(environmentName)) {
  throw new Error('El contexto environment debe ser dev o prod.');
}

new RutasPastoStack(app, `RutasPastoAws-${environmentName}`, {
  environmentName,
  production: environmentName === 'prod',
  servicesEnabled,
});
