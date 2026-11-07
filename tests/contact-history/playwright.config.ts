import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../../playwright.config";
import { appPort, appURL, backendURL } from "../e2e/fixtures/endpoints";
const root = resolve(__dirname, "../..");

export default defineConfig({
    ...base,
    testDir: "../e2e", testMatch: "contact-history.spec.ts",
    outputDir: resolve(root, "test-results/contact-history"),
    reporter: [["list"], ["html", { open: "never", outputFolder: resolve(root, "playwright-report/contact-history") }]],
    webServer: [
        { command: "node tests/e2e/fixtures/supabase-server.mjs", cwd: root, url: `${backendURL}/health`, reuseExistingServer: false },
        { command: `npm run start -- --hostname 127.0.0.1 --port ${appPort}`, cwd: root, url: `${appURL}/login`, reuseExistingServer: false, timeout: 60000 },
    ],
});
