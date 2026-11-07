import { defineConfig, devices } from '@playwright/test';

// E2E : le serveur sert le front buildé (apps/web/dist) sur une base temporaire, sans aucun secret.
// E2E_PORT : autre port (plusieurs suites en parallèle sur la machine) ; la base suit le port.
const PORT = Number(process.env.E2E_PORT ?? 8788);
const DB = PORT === 8788 ? 'var/e2e.db' : `var/e2e-${PORT}.db`;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['iPhone 14'],
    browserName: 'chromium',
    geolocation: { latitude: 48.8611, longitude: 2.3358, accuracy: 10 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.ts/ },
    { name: 'full', testMatch: /.*\.spec\.ts/ },
  ],
  webServer: {
    command: `rm -f ${DB}* && node apps/server/src/index.ts`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test', PORT: String(PORT), DB_PATH: DB, PUBLIC_URL: `http://localhost:${PORT}`,
      FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', JOBS: '0', DEMO_TOKEN: 'e2e-judge', ADMIN_TOKEN: 'e2e-admin',
      // carte vivante : les 24 runners marchent (sans commercer : les prix des specs restent stables)
      RUNNERS: '24', RUNNER_TRADES: '0',
    },
  },
});
