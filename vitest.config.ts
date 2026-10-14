import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
