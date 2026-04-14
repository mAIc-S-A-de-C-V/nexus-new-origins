import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,            // sequential — modules depend on each other
  reporter: [
    ['list'],
    ['json', { outputFile: 'results/qa-report.json' }],
    ['html', { outputFolder: 'results/html-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    video: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
  },
});
