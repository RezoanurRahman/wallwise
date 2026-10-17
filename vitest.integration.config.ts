import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const setupFiles = ['tests/integration/setup.ts', 'src/server/test/setup.ts']
  .map((file) => resolve(process.cwd(), file))
  .filter((file) => existsSync(file));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles,
    include: ['tests/integration/**/*.test.ts', 'src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.tmp/**', 'tests/e2e/**'],
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
