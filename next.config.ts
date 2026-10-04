import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const isVercelBuild = process.env.VERCEL === '1';
const isAwsContainerBuild = process.env.AWS_DEPLOYMENT === '1';
const isVercelProductionBuild = isVercelBuild && process.env.VERCEL_ENV === 'production';
const configuredPythonApiUrl = process.env.PYTHON_API_URL?.trim();
const pythonApiUrl = isAwsContainerBuild
  ? null
  : configuredPythonApiUrl || (isVercelBuild ? null : 'http://127.0.0.1:8000');

if (isVercelProductionBuild && pythonApiUrl === null) {
  throw new Error('PYTHON_API_URL es obligatorio en producción para conectar la API desplegada en AWS.');
}

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
  if (isVercelProductionBuild && backendUrl.protocol !== 'https:') {
    throw new Error('PYTHON_API_URL debe usar HTTPS en producción.');
  }
}

const nextConfig: NextConfig = {
  // Conserva la imagen contenedorizable para desarrollo; Vercel ejecuta Next.js como framework.
  output: 'standalone',
  // Permite validar un build aislado sin borrar los artefactos del `next dev` abierto.
  distDir: process.env.NEXT_BUILD_CHECK_DIR?.trim() || '.next',
  outputFileTracingRoot: projectRoot,
  // Next.js debe recibir los secretos desde el entorno de Vercel, nunca desde archivos locales.
  outputFileTracingExcludes: {
    '/*': ['./.env', './.env.*', './.vercel/.env.*'],
  },
  async rewrites() {
    // El navegador conserva el dominio Vercel; el proxy server-side envía /api a AWS por HTTPS.
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
