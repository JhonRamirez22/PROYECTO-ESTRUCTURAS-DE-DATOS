import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const DATABASE_NAME = 'rutas_pasto';
const DATABASE_ADMIN_USERNAME = 'rutas_admin';
const DATABASE_APPLICATION_USERNAME = 'rutas_app';
const RDS_CA_BUNDLE = '/etc/ssl/certs/rds-global-bundle.pem';

const INTEGRATION_SECRET_FIELDS = [
  'CUSTOMER_CHAT_API_KEY',
  'TOMTOM_API_KEY',
  'ORS_API_KEY',
  'AI_TRAFFIC_API_URL',
  'AI_TRAFFIC_API_KEY',
  'AI_TRAFFIC_MODEL',
  'NOTIFICATION_SMTP_HOST',
  'NOTIFICATION_SMTP_USERNAME',
  'NOTIFICATION_SMTP_PASSWORD',
  'NOTIFICATION_FROM_EMAIL',
  'NOTIFICATION_SMS_TWILIO_ACCOUNT_SID',
  'NOTIFICATION_SMS_TWILIO_AUTH_TOKEN',
  'NOTIFICATION_SMS_TWILIO_FROM_PHONE',
] as const;

interface RutasPastoStackProps extends StackProps {
  environmentName: string;
  production: boolean;
  servicesEnabled: boolean;
  certificateArn?: string;
}

export class RutasPastoStack extends Stack {
  constructor(scope: Construct, id: string, props: RutasPastoStackProps) {
    super(scope, id, props);

    const { environmentName, production, servicesEnabled, certificateArn } = props;
    const resourcePrefix = `rutas-pasto/${environmentName}`;
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const imagePlatform = ecrAssets.Platform.LINUX_ARM64;

    const vpc = new ec2.Vpc(this, 'ApplicationVpc', {
      maxAzs: 2,
      natGateways: production ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const loadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      description: 'Entrada web; TLS es obligatorio en prod.',
      allowAllOutbound: true,
    });
    loadBalancerSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP público o redirección a HTTPS'
    );
    if (production) {
      loadBalancerSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        'HTTPS público'
      );
    }

    const frontendSecurityGroup = new ec2.SecurityGroup(this, 'FrontendSecurityGroup', {
      vpc,
      description: 'Next.js traffic only from the ALB.',
      allowAllOutbound: true,
    });
    frontendSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(3000),
      'Tráfico web del ALB'
    );

    const backendSecurityGroup = new ec2.SecurityGroup(this, 'BackendSecurityGroup', {
      vpc,
      description: 'FastAPI traffic only from the ALB.',
      allowAllOutbound: true,
    });
    backendSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(8000),
      'Tráfico /api del ALB'
    );

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'PostgreSQL privado; solo accesible desde FastAPI.',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(
      backendSecurityGroup,
      ec2.Port.tcp(5432),
      'Conexión TLS desde tareas FastAPI'
    );

    const authSecret = this.createGeneratedSecret(
      'SessionSigningSecret',
      `${resourcePrefix}/auth-secret`,
      64
    );
    const dispatcherCodeSecret = this.createGeneratedSecret(
      'DispatcherAccessCode',
      `${resourcePrefix}/dispatcher-access-code`,
      48
    );
    const applicationDatabasePassword = this.createGeneratedSecret(
      'ApplicationDatabasePassword',
      `${resourcePrefix}/database-app-password`,
      64
    );
    const integrationSecret = new secretsmanager.Secret(this, 'IntegrationCredentials', {
      secretName: `${resourcePrefix}/integrations`,
      description:
        'Claves opcionales de OSRM alternativo, TomTom, IA, correo y SMS de Rutas Pasto.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify(
          Object.fromEntries(INTEGRATION_SECRET_FIELDS.map((field) => [field, '']))
        ),
        generateStringKey: '_bootstrap_value',
        passwordLength: 32,
        excludePunctuation: true,
      },
    });
    integrationSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const postgresVersion = rds.PostgresEngineVersion.of('16.15', '16');
    const postgresEngine = rds.DatabaseInstanceEngine.postgres({ version: postgresVersion });
    const databaseParameterGroup = new rds.ParameterGroup(this, 'PostgresParameters', {
      engine: postgresEngine,
      parameters: { 'rds.force_ssl': '1' },
    });
    const database = new rds.DatabaseInstance(this, 'PostgresDatabase', {
      databaseName: DATABASE_NAME,
      engine: postgresEngine,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        production ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO
      ),
      credentials: rds.Credentials.fromGeneratedSecret(DATABASE_ADMIN_USERNAME, {
        secretName: `${resourcePrefix}/database-admin`,
      }),
      parameterGroup: databaseParameterGroup,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      publiclyAccessible: false,
      storageEncrypted: true,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      multiAz: production,
      backupRetention: Duration.days(production ? 14 : 7),
      deleteAutomatedBackups: false,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ['postgresql'],
    });
    database.secret?.applyRemovalPolicy(RemovalPolicy.RETAIN);
    applicationDatabasePassword.applyRemovalPolicy(RemovalPolicy.RETAIN);
    authSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);
    dispatcherCodeSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const cluster = new ecs.Cluster(this, 'ApplicationCluster', {
      vpc,
      clusterName: `rutas-pasto-${environmentName}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const frontendImage = new ecrAssets.DockerImageAsset(this, 'FrontendImage', {
      directory: repositoryRoot,
      file: 'Dockerfile',
      platform: imagePlatform,
    });
    const backendImage = new ecrAssets.DockerImageAsset(this, 'BackendImage', {
      directory: path.join(repositoryRoot, 'backend'),
      file: 'Dockerfile',
      platform: imagePlatform,
    });

    const backendEnvironment: Record<string, string> = {
      NODE_ENV: production ? 'production' : 'development',
      DATABASE_HOST: database.instanceEndpoint.hostname,
      DATABASE_PORT: '5432',
      DATABASE_NAME,
      DATABASE_USERNAME: DATABASE_APPLICATION_USERNAME,
      DATABASE_SSL_MODE: 'verify-full',
      DATABASE_SSL_ROOT_CERT: RDS_CA_BUNDLE,
      CUSTOMER_NOTIFICATION_WORKER_ENABLED: 'true',
      CUSTOMER_NOTIFICATION_POLL_SECONDS: '30',
      AI_ALLOW_LOCATION_DATA_SHARING: 'false',
      ROUTING_PROVIDER: 'osrm',
      OSRM_API_URL: 'https://router.project-osrm.org',
      CUSTOMER_CHAT_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
      CUSTOMER_CHAT_MODEL: 'openai/gpt-oss-20b',
      CUSTOMER_CHAT_TIMEOUT_MS: '5000',
      NOTIFICATION_SMTP_PORT: '587',
      NOTIFICATION_SMTP_TIMEOUT_MS: '5000',
      NOTIFICATION_SMS_TIMEOUT_MS: '5000',
      TOMTOM_TRAFFIC_TIMEOUT_MS: '3500',
      AI_TRAFFIC_TIMEOUT_MS: '5000',
    };

    const applicationTaskDefinition = this.createTaskDefinition(
      'BackendTaskDefinition',
      `${resourcePrefix}-backend`,
      512,
      1024
    );
    const backendContainer = applicationTaskDefinition.addContainer('FastApi', {
      image: ecs.ContainerImage.fromDockerImageAsset(backendImage),
      environment: backendEnvironment,
      logging: this.createLogs('BackendLogs', `/aws/ecs/${resourcePrefix}/backend`),
      stopTimeout: Duration.seconds(60),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'python -c "from urllib.request import urlopen; urlopen(\'http://127.0.0.1:8000/api/health\', timeout=3)" || exit 1',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(45),
      },
    });
    backendContainer.addPortMappings({ containerPort: 8000, protocol: ecs.Protocol.TCP });
    this.addDatabaseSecrets(backendContainer, applicationDatabasePassword);
    backendContainer.addSecret('AUTH_SECRET', ecs.Secret.fromSecretsManager(authSecret));
    backendContainer.addSecret(
      'DISPATCHER_ACCESS_CODE',
      ecs.Secret.fromSecretsManager(dispatcherCodeSecret)
    );
    this.addIntegrationSecrets(backendContainer, integrationSecret);

    const bootstrapTaskDefinition = this.createTaskDefinition(
      'DatabaseBootstrapTaskDefinition',
      `${resourcePrefix}-database-bootstrap`,
      256,
      512
    );
    const bootstrapContainer = bootstrapTaskDefinition.addContainer('BootstrapDatabaseRole', {
      image: ecs.ContainerImage.fromDockerImageAsset(backendImage),
      command: ['python', '-m', 'scripts.bootstrap_database_role'],
      environment: {
        DATABASE_HOST: database.instanceEndpoint.hostname,
        DATABASE_PORT: '5432',
        DATABASE_NAME,
        DATABASE_USERNAME: DATABASE_APPLICATION_USERNAME,
        DATABASE_ADMIN_USERNAME,
        DATABASE_SSL_MODE: 'verify-full',
        DATABASE_SSL_ROOT_CERT: RDS_CA_BUNDLE,
      },
      logging: this.createLogs('DatabaseBootstrapLogs', `/aws/ecs/${resourcePrefix}/db-bootstrap`),
      stopTimeout: Duration.seconds(60),
    });
    this.addDatabaseSecrets(bootstrapContainer, applicationDatabasePassword);
    const adminSecret = database.secret;
    if (adminSecret === undefined) {
      throw new Error('RDS debe generar un secreto para el usuario admin.');
    }
    bootstrapContainer.addSecret(
      'DATABASE_ADMIN_PASSWORD',
      ecs.Secret.fromSecretsManager(adminSecret, 'password')
    );

    const migrationTaskDefinition = this.createTaskDefinition(
      'DatabaseMigrationTaskDefinition',
      `${resourcePrefix}-database-migrate`,
      256,
      512
    );
    const migrationContainer = migrationTaskDefinition.addContainer('AlembicMigration', {
      image: ecs.ContainerImage.fromDockerImageAsset(backendImage),
      command: ['alembic', 'upgrade', 'head'],
      environment: {
        DATABASE_HOST: database.instanceEndpoint.hostname,
        DATABASE_PORT: '5432',
        DATABASE_NAME,
        DATABASE_USERNAME: DATABASE_APPLICATION_USERNAME,
        DATABASE_SSL_MODE: 'verify-full',
        DATABASE_SSL_ROOT_CERT: RDS_CA_BUNDLE,
      },
      logging: this.createLogs('DatabaseMigrationLogs', `/aws/ecs/${resourcePrefix}/db-migrate`),
      stopTimeout: Duration.seconds(120),
    });
    this.addDatabaseSecrets(migrationContainer, applicationDatabasePassword);

    const frontendTaskDefinition = this.createTaskDefinition(
      'FrontendTaskDefinition',
      `${resourcePrefix}-frontend`,
      512,
      1024
    );
    const frontendContainer = frontendTaskDefinition.addContainer('NextJs', {
      image: ecs.ContainerImage.fromDockerImageAsset(frontendImage),
      environment: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_MAP_DEFAULT_LAT: '1.2136',
        NEXT_PUBLIC_MAP_DEFAULT_LNG: '-77.2811',
      },
      logging: this.createLogs('FrontendLogs', `/aws/ecs/${resourcePrefix}/frontend`),
      stopTimeout: Duration.seconds(60),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'node -e "fetch(\'http://127.0.0.1:3000/\').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(45),
      },
    });
    frontendContainer.addPortMappings({ containerPort: 3000, protocol: ecs.Protocol.TCP });

    const frontendService = this.createService(
      'FrontendService',
      cluster,
      frontendTaskDefinition,
      frontendSecurityGroup,
      servicesEnabled ? (production ? 2 : 1) : 0
    );
    const backendService = this.createService(
      'BackendService',
      cluster,
      applicationTaskDefinition,
      backendSecurityGroup,
      servicesEnabled ? 1 : 0
    );

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ApplicationLoadBalancer', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: loadBalancerSecurityGroup,
      deletionProtection: production,
    });

    let webListener: elbv2.ApplicationListener;
    if (certificateArn !== undefined) {
      webListener = loadBalancer.addListener('HttpsListener', {
        port: 443,
        open: false,
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn)],
        sslPolicy: elbv2.SslPolicy.TLS13_RES,
      });
      const httpListener = loadBalancer.addListener('HttpRedirectListener', {
        port: 80,
        open: false,
      });
      httpListener.addAction('RedirectToHttps', {
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    } else {
      webListener = loadBalancer.addListener('HttpListener', {
        port: 80,
        open: false,
      });
    }

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BackendTargetGroup', {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [backendService],
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: Duration.seconds(30),
    });
    webListener.addTargetGroups('ApiPathRouting', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api', '/api/*'])],
      targetGroups: [apiTargetGroup],
    });
    webListener.addTargets('FrontendDefault', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [frontendService],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: Duration.seconds(30),
    });

    new cdk.CfnOutput(this, 'ApplicationUrl', {
      value: `${certificateArn ? 'https' : 'http'}://${loadBalancer.loadBalancerDnsName}`,
      description: 'Punto de entrada único; el ALB envía /api/* a FastAPI y el resto a Next.js.',
    });
    new cdk.CfnOutput(this, 'EcsClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'Hostname privado; PostgreSQL no es público.',
    });
    new cdk.CfnOutput(this, 'DatabaseBootstrapTaskDefinitionArn', {
      value: bootstrapTaskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, 'DatabaseMigrationTaskDefinitionArn', {
      value: migrationTaskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: cdk.Fn.join(
        ',',
        vpc.privateSubnets.map((subnet) => subnet.subnetId)
      ),
    });
    new cdk.CfnOutput(this, 'BackendSecurityGroupId', {
      value: backendSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, 'DispatcherCodeSecretName', {
      value: dispatcherCodeSecret.secretName,
      description: 'Obtén su valor en Secrets Manager después del despliegue; no se imprime.',
    });
    new cdk.CfnOutput(this, 'IntegrationSecretName', {
      value: integrationSecret.secretName,
    });
    new cdk.CfnOutput(this, 'ServicesInitiallyEnabled', {
      value: servicesEnabled ? 'true' : 'false',
      description: 'Los servicios empiezan detenidos hasta inicializar rol y migraciones.',
    });
  }

  private createGeneratedSecret(
    id: string,
    secretName: string,
    passwordLength: number
  ): secretsmanager.Secret {
    const secret = new secretsmanager.Secret(this, id, {
      secretName,
      generateSecretString: {
        passwordLength,
        excludePunctuation: true,
      },
    });
    return secret;
  }

  private createTaskDefinition(
    id: string,
    family: string,
    cpu: number,
    memoryLimitMiB: number
  ): ecs.FargateTaskDefinition {
    return new ecs.FargateTaskDefinition(this, id, {
      family,
      cpu,
      memoryLimitMiB,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });
  }

  private createLogs(id: string, logGroupName: string): ecs.LogDriver {
    const logGroup = new logs.LogGroup(this, id, {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    return ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'task' });
  }

  private addDatabaseSecrets(
    container: ecs.ContainerDefinition,
    applicationPassword: secretsmanager.ISecret
  ): void {
    container.addSecret('DATABASE_PASSWORD', ecs.Secret.fromSecretsManager(applicationPassword));
  }

  private addIntegrationSecrets(
    container: ecs.ContainerDefinition,
    secret: secretsmanager.ISecret
  ): void {
    for (const field of INTEGRATION_SECRET_FIELDS) {
      container.addSecret(field, ecs.Secret.fromSecretsManager(secret, field));
    }
  }

  private createService(
    id: string,
    cluster: ecs.Cluster,
    taskDefinition: ecs.FargateTaskDefinition,
    securityGroup: ec2.SecurityGroup,
    desiredCount: number
  ): ecs.FargateService {
    return new ecs.FargateService(this, id, {
      cluster,
      taskDefinition,
      desiredCount,
      assignPublicIp: false,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      enableECSManagedTags: true,
    });
  }
}
