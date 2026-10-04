import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { getProductionAuthConfigurationErrors } from './src/lib/auth/productionConfiguration';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const isVercelBuild = process.env.VERCEL === '1';
const isAwsContainerBuild = process.env.AWS_DEPLOYMENT === '1';
const pythonApiUrl = isVercelBuild || isAwsContainerBuild
  ? null
  : process.env.PYTHON_API_URL?.trim() || 'http://127.0.0.1:8000';
const isVercelProductionBuild = isVercelBuild && process.env.VERCEL_ENV === 'production';

if (pythonApiUrl !== null) {
  const backendUrl = new URL(pythonApiUrl);
  if (
    !['http:', 'https:'].includes(backendUrl.protocol) ||
    backendUrl.pathname !== '/' ||
    backendUrl.search !== '' ||
    backendUrl.hash !== ''
  ) {
    throw new Error('PYTHON_API_URL debe ser el origen HTTP(S) del backend, sin ruta.');
  }
}

if (isVercelProductionBuild) {
  const missingAuthConfiguration = getProductionAuthConfigurationErrors(process.env);
  if (missingAuthConfiguration.length > 0) {
    throw new Error(
      `No se puede publicar sin credenciales privadas válidas: ${missingAuthConfiguration.join(', ')}.`
    );
  }
}

const nextConfig: NextConfig = {
  // ECS sirve la interfaz en un contenedor Node; el ALB reenvía /api/* a FastAPI.
  output: 'standalone',
  // Permite validar un build aislado sin borrar los artefactos del `next dev` abierto.
  distDir: process.env.NEXT_BUILD_CHECK_DIR?.trim() || '.next',
  outputFileTracingRoot: projectRoot,
  // Next.js debe recibir los secretos desde el entorno de Vercel, nunca desde archivos locales.
  outputFileTracingExcludes: {
    '/*': ['./.env', './.env.*', './.vercel/.env.*'],
  },
  async rewrites() {
    // En producción, las reglas del proyecto enrutan /api directamente al servicio FastAPI.
    if (pythonApiUrl === null) return [];

    return {
      // En local, Next conserva una URL cómoda y reenvía /api al proceso Python.
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${pythonApiUrl}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
