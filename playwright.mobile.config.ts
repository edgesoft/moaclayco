import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/mobile",
  projects: [
    {
      name: "android-chromium-360px",
      use: {
        ...devices["Galaxy S24"],
      },
    },
    {
      name: "iphone-webkit",
      use: {
        ...devices["iPhone 13"],
      },
    },
  ],
  reporter: process.env.CI ? "github" : "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/browser",
  timeout: 45_000,
  use: {
    baseURL:
      process.env.MOBILE_E2E_BASE_URL ??
      "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
