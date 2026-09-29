import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./apps/test-sites/e2e",
  timeout: 120000,
  expect: { timeout: 15000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm dev:sites --port 4173",
    url: "http://127.0.0.1:4173/?mode=static",
    reuseExistingServer: true,
    timeout: 30000,
  },
})
