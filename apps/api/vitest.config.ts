import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef0123',
      ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef0123',
      LOG_LEVEL: 'error',
      BILLING_ENABLED: 'true',
      PUBLIC_SIGNUP_CREDITS: '250',
      RUN_WORKER_IN_PROCESS: 'false',
      STORAGE_DRIVER: 'local',
      STORAGE_DIR: 'data/test-storage',
      AI_PROVIDER: 'none',
      PAYMENT_PROVIDER: 'dodo',
      DODO_WEBHOOK_SECRET: 'whsec_testsecretvalue',
      DODO_API_KEY: 'test_key',
      ADMIN_EMAILS: 'admin@example.com',
      GITHUB_APP_WEBHOOK_SECRET: 'github-webhook-test-secret',
    },
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    isolate: false,
  },
});
