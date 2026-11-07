import { defineConfig, devices } from '@playwright/test';

// E2E : le serveur sert le front buildé (apps/web/dist) sur une base temporaire, sans aucun secret.
const PORT = Number(process.env.E2E_PORT ?? 8788); // E2E_PORT : plusieurs suites en parallèle sur la même machine
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
    command: `rm -f var/e2e-${PORT}.db* && node apps/server/src/index.ts`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test', PORT: String(PORT), DB_PATH: `var/e2e-${PORT}.db`, PUBLIC_URL: `http://localhost:${PORT}`,
      FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', JOBS: '0', DEMO_TOKEN: 'e2e-judge', ADMIN_TOKEN: 'e2e-admin',
      // monde « partout » sans réseau : miroir Overpass injoignable → repli procédural (déterministe)
      OVERPASS_URLS: 'http://127.0.0.1:9/api/interpreter',
      // carte vivante : les 24 runners marchent (sans commercer : les prix des specs restent stables)
      RUNNERS: '24', RUNNER_TRADES: '0',
    },
  },
});
