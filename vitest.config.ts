import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/dist/**', '**/drizzle/**', '**/*.config.ts', 'apps/**/src/index.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
