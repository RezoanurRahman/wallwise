import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const setupFiles = ['src/test/setup.ts', 'src/client/test/setup.ts', 'tests/setup.ts']
  .map((file) => resolve(process.cwd(), file))
  .filter((file) => existsSync(file));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles,
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/unit/**/*.{test,spec}.{ts,tsx}',
      'tests/components/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.tmp/**',
      '**/*.integration.test.{ts,tsx}',
      'tests/e2e/**',
    ],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
