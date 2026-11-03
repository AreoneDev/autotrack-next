import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
const root = path.resolve(__dirname, "../..");

export default defineConfig({
    testDir: ".",
    testMatch: "*.spec.ts",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    timeout: 120000,
    reporter: [["list"], ["json", { outputFile: path.join(root, "nfr-reports/browser.json") }]],
    outputDir: path.join(root, "nfr-reports/traces"),
    use: {
        baseURL: "http://127.0.0.1:3200",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: [
        {
            cwd: root,
            command: "node tests/e2e/fixtures/supabase-server.mjs",
            url: "http://127.0.0.1:54339/health",
            reuseExistingServer: false,
            env: { AUTOTRACK_TEST_BACKEND_PORT: "54339" },
        },
        {
            cwd: root,
            command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3200",
            url: "http://127.0.0.1:3200/login",
            reuseExistingServer: false,
            timeout: 180000,
            env: {
                NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54339",
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "nfr-synthetic-public-key",
                NEXT_TELEMETRY_DISABLED: "1",
                TZ: "America/Toronto",
            },
        },
    ],
});
