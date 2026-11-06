import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const appURL = "http://127.0.0.1:3200";
const backendURL = "http://127.0.0.1:54339";
const test = base.extend({
    page: async ({ page }, run) => {
        await page.route("**/*", async (route) => {
            const origin = new URL(route.request().url()).origin;
            if (![appURL, backendURL].includes(origin)) {
                await route.abort();
                throw new Error("Unexpected browser egress: " + origin);
            }
            await route.continue();
        });
        await run(page);
    },
});

async function seed(request: APIRequestContext, count: number, firstName?: string) {
    expect((await request.post(backendURL + "/__test__/reset")).ok()).toBe(true);
    const login = await request.post(backendURL + "/auth/v1/token?grant_type=password", {
        data: { email: "ada@example.test", password: "test-password-123" },
    });
    expect(login.ok()).toBe(true);
    const { access_token: token } = await login.json();
    const result = await request.post(backendURL + "/rest/v1/leads", {
        headers: { Authorization: "Bearer " + token },
        data: Array.from({ length: count }, (_, i) => ({
            first_name: i === 0 && firstName ? firstName : "Synthetic",
            last_name: "Customer" + i,
            lead_email: "customer" + i + "@example.test",
            stage: "NEW", status: true, score: 50, budget: 30000,
            created_at: "2026-06-01T12:00:00Z",
            follow_up_date: "2026-06-20T12:00:00Z",
        })),
    });
    expect(result.ok()).toBe(true);
}

test("SEC-HTTP-01: spoofed proxy headers and malformed cookies cannot bypass anonymous protection", async ({ request }) => {
    for (const path of ["/dashboard", "/leads", "/leads/100", "/agenda", "/analytics"]) {
        for (const headers of [
            {},
            { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
            { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy", Cookie: "sb-127-auth-token=not-a-session" },
        ] as Record<string, string>[]) {
            const response = await request.get(path + "?private=synthetic", { headers, maxRedirects: 0 });
            expect(response.status()).toBe(307);
            expect(new URL(response.headers().location, appURL).href).toBe(appURL + "/login");
            expect(response.headers()["cache-control"]).toContain("no-store");
            expect(await response.text()).not.toContain("customer0@example.test");
            await response.dispose();
        }
    }
});

test("SEC-HTTP-02: callback redirect parameters stay local and legacy mutation routes stay closed", async ({ request }) => {
    const callback = await request.get("/auth/callback?next=https://attacker.example.test&redirect_to=//attacker.example.test", { maxRedirects: 0 });
    expect(callback.status()).toBe(307);
    const destination = new URL(callback.headers().location, appURL);
    expect(["127.0.0.1", "localhost"]).toContain(destination.hostname);
    expect(destination.port).toBe("3200");
    expect(destination.pathname + destination.search).toBe("/login?error=callback");
    expect(callback.headers()["cache-control"]).toContain("no-store");
    for (const path of ["/test-lead-repo", "/test-task-repo", "/test-anything"]) {
        expect((await request.get(path)).status()).toBe(404);
    }
});

test("SEC-XSS-01: persisted HTML payload is rendered as text without execution", async ({ page, request }) => {
    const payload = '<img src=x onerror="window.__nfrXss=1">';
    await seed(request, 1, payload);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: payload + " Customer0", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__nfrXss)).toBeUndefined();
    expect(await page.locator('img[onerror]').count()).toBe(0);
});

test("PERF-UI-01: 1,000 synthetic leads load and filter within the local regression budget", async ({ page, request }) => {
    await seed(request, 1000);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    let associationRequests = 0;
    page.on("request", request => {
        if (/\/rest\/v1\/lead_(vehicle_interests|trade_in_vehicles)/.test(request.url())) associationRequests++;
    });
    const started = performance.now();
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: "Synthetic Customer999", exact: true })).toBeAttached();
    const loadMs = performance.now() - started;
    const filtered = performance.now();
    await page.getByPlaceholder("Search by customer name, email, or phone").fill("customer999@example.test");
    await expect(page.getByRole("row")).toHaveCount(2);
    const filterMs = performance.now() - filtered;
    const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return { ttfbMs: entry.responseStart - entry.requestStart, domContentLoadedMs: entry.domContentLoadedEventEnd };
    });
    const report = { fixtureLeads: 1000, associationRequests, loadMs, filterMs, ...navigation, budgets: { loadMs: 5000, filterMs: 1000, ttfbMs: 1500 } };
    await mkdir("nfr-reports", { recursive: true });
    await writeFile("nfr-reports/ui-performance.json", JSON.stringify(report, null, 2));
    console.log("PERF-UI-01", JSON.stringify(report));
    expect(associationRequests).toBe(10);
    expect(loadMs).toBeLessThan(5000);
    expect(filterMs).toBeLessThan(1000);
    expect(navigation.ttfbMs).toBeLessThan(1500);
});

test("LOAD-HTTP-01: bounded production-server concurrency, correctness and recovery", async ({ request }) => {
    // This closed workload has no configurable target, credentials, or remote service.
    const phases = [];
    for (const [concurrency, samples] of [[1, 30], [5, 100], [10, 200], [1, 30]]) {
        let issued = 0;
        let failures = 0;
        const latencies: number[] = [];
        const started = performance.now();
        await Promise.all(Array.from({ length: concurrency }, async () => {
            while (issued < samples) {
                const index = issued++;
                const before = performance.now();
                try {
                    const isLogin = index % 2 === 0;
                    const response = await request.get(isLogin ? "/login" : "/dashboard", { maxRedirects: 0, timeout: 5000 });
                    const body = await response.text();
                    const valid = isLogin
                        ? response.status() === 200 && body.includes("Sign in")
                        : response.status() === 307 && new URL(response.headers().location, appURL).pathname === "/login";
                    if (!valid || !response.headers()["cache-control"]?.includes("no-store")) failures++;
                    await response.dispose();
                } catch {
                    failures++;
                }
                latencies.push(performance.now() - before);
            }
        }));
        latencies.sort((a, b) => a - b);
        const elapsedMs = performance.now() - started;
        phases.push({ concurrency, samples, failures, elapsedMs, requestsPerSecond: samples * 1000 / elapsedMs,
            p50Ms: latencies[Math.ceil(samples * .5) - 1], p95Ms: latencies[Math.ceil(samples * .95) - 1],
            maxMs: latencies.at(-1) });
    }
    const report = { phases, budgets: { failures: 0, p95Ms: 2000, requestTimeoutMs: 5000 }, scope: "Next.js login HTML and anonymous redirects; no Supabase capacity claim" };
    await mkdir("nfr-reports", { recursive: true });
    await writeFile("nfr-reports/http-load.json", JSON.stringify(report, null, 2));
    console.log("LOAD-HTTP-01", JSON.stringify(report));
    for (const phase of phases) {
        expect(phase.failures).toBe(0);
        expect(phase.p95Ms).toBeLessThan(2000);
    }
});
