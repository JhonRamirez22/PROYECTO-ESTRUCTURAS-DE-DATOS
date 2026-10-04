import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: currentDirectory,
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: [resolve(currentDirectory, './tests/setup.ts')],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(currentDirectory, './src'),
    },
  },
})
