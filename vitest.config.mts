import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/plugins/tenant-plugin/e2e/test-setup.ts'],
    include: ['src/**/*.e2e-spec.ts'],
    typecheck: {
      tsconfig: path.join(__dirname, 'tsconfig.e2e.json'),
    },
    // Run each suite in its own fork — NestJS DI wiring requires an isolated
    // module registry; parallel threads share module state and cause conflicts.
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  plugins: [
    // SWC compiles TypeScript decorators used by NestJS/Vendure.
    // https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
    swc.vite({
      jsc: {
        transform: {
          // Required for Vendure entity/decorator patterns.
          // https://github.com/vendurehq/vendure/issues/2099
          useDefineForClassFields: false,
        },
      },
    }),
  ],
});
