// Tests contre la démo EN LIGNE (aucun serveur local) : npx playwright test -c playwright.prod.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e-prod',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PROD_URL ?? 'https://tokengo-production-195c.up.railway.app',
    ...devices['iPhone 14'],
    browserName: 'chromium',
    geolocation: { latitude: 48.8611, longitude: 2.3358, accuracy: 10 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
  },
});
