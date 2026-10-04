import * as cdk from 'aws-cdk-lib';
import { RutasPastoStack } from '../lib/rutas-pasto-stack';

const app = new cdk.App();
const environmentName = String(app.node.tryGetContext('environment') ?? 'dev');
const servicesEnabled = String(app.node.tryGetContext('servicesEnabled') ?? 'false') === 'true';
const certificateArnValue = app.node.tryGetContext('certificateArn');
const certificateArn =
  typeof certificateArnValue === 'string' && certificateArnValue.trim()
    ? certificateArnValue.trim()
    : undefined;

if (!['dev', 'prod'].includes(environmentName)) {
  throw new Error('El contexto environment debe ser dev o prod.');
}
if (environmentName === 'prod' && !certificateArn) {
  throw new Error('Para prod se requiere -c certificateArn=<ARN de ACM validado>.');
}

new RutasPastoStack(app, `RutasPastoAws-${environmentName}`, {
  environmentName,
  production: environmentName === 'prod',
  servicesEnabled,
  certificateArn,
});
