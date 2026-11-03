import { defineConfig, devices } from "@playwright/test";

import { appPort, appURL, backendURL } from "./tests/e2e/fixtures/endpoints";

export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    workers: 1, // The isolated backend is reset between tests.
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: appURL,
        timezoneId: "America/Toronto",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    ],
    webServer: [
        {
            command: "node tests/e2e/fixtures/supabase-server.mjs",
            url: `${backendURL}/health`,
            reuseExistingServer: false,
        },
        {
            command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${appPort}`,
            url: `${appURL}/login`,
            timeout: 180000,
            reuseExistingServer: false,
            env: {
                NEXT_PUBLIC_SUPABASE_URL: backendURL,
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-synthetic-public-key",
                NEXT_TELEMETRY_DISABLED: "1",
                TZ: "America/Toronto",
            },
        },
    ],
});
