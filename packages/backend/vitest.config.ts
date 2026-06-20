import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/game/__tests__/globalSetup.ts'],
    globalSetup: ['./src/game/__tests__/globalSetup.ts'],
  },
});
