import { defineConfig, devices } from '@playwright/test';
import { E2E_AUTH_SECRET, E2E_DISPATCHER_CODE } from './tests/e2e/auth';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const appPort = new URL(baseURL).port || '3000';
const pythonApiPort = process.env.PYTHON_API_PORT?.trim() || '8000';
const pythonApiURL = process.env.PYTHON_API_URL?.trim() || 'http://127.0.0.1:' + pythonApiPort;
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1';

export default defineConfig({
  testDir: './tests/e2e',
  // Ambos flujos usan la misma PostgreSQL y el dashboard opera sobre las
  // colas globales de pedidos; paralelizarlos mezcla los datos de prueba.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...(useSystemChrome ? { launchOptions: { channel: 'chrome' as const } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node tests/e2e/orsMockServer.mjs',
      url: 'http://127.0.0.1:4010/health',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'pnpm dev',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        AI_TRAFFIC_API_KEY: '',
        AI_TRAFFIC_API_URL: '',
        AI_TRAFFIC_MODEL: '',
        AI_ALLOW_LOCATION_DATA_SHARING: 'false',
        TOMTOM_API_KEY: '',
        NOTIFICATION_SMTP_HOST: '',
        NOTIFICATION_SMTP_USERNAME: '',
        NOTIFICATION_SMTP_PASSWORD: '',
        NOTIFICATION_FROM_EMAIL: '',
        NOTIFICATION_SMS_TWILIO_ACCOUNT_SID: '',
        NOTIFICATION_SMS_TWILIO_AUTH_TOKEN: '',
        NOTIFICATION_SMS_TWILIO_FROM_PHONE: '',
        AUTH_SECRET: E2E_AUTH_SECRET,
        DISPATCHER_ACCESS_CODE: E2E_DISPATCHER_CODE,
        OSRM_API_URL: 'http://127.0.0.1:4010',
        PYTHON_API_HOST: '127.0.0.1',
        PYTHON_API_PORT: pythonApiPort,
        PYTHON_API_URL: pythonApiURL,
        PYTHON_RELOAD: '0',
        NEXT_DEV_HOSTNAME: '127.0.0.1',
        PORT: appPort,
      },
    },
  ],
});
