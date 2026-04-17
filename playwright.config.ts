import { defineConfig, devices } from "@playwright/test";

// E2E runs against a locally-served copy of index.html by default, so edits
// to the working tree are caught before they ship. Set ADARA_E2E_BASE_URL to
// override (e.g. "https://onboard.adara.network" for a prod smoke).
const BASE_URL = process.env.ADARA_E2E_BASE_URL || "http://127.0.0.1:4173";
const USE_LOCAL_SERVER = !process.env.ADARA_E2E_BASE_URL;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false, // the flow creates on-chain state sequentially; don't race
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000, // a full 7-step cycle, with chain confirmations
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The devnet RPC sends duplicate Access-Control-Allow-Origin headers
        // (Besu echoes Origin + nginx adds '*'); real users are unaffected
        // because MetaMask bypasses browser CORS, but our stub fetches directly.
        // The nginx fix is committed to Adara Protocol repo; until that's
        // deployed, bypass browser CORS in the test harness.
        launchOptions: {
          args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
        },
      },
    },
  ],
  ...(USE_LOCAL_SERVER
    ? {
        webServer: {
          command: "npm run serve",
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }
    : {}),
});
