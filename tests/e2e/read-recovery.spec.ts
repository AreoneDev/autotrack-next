import { expect, test } from "@playwright/test";
import { backendURL } from "./fixtures/endpoints";
import { day, lead, login, reset, state, task } from "./fixtures/journeys";

const seed = () => ({
    leads: [lead()],
    tasks: [task(10, "Call customer")],
    notifications: [{ notification_id: 20, lead_id: 1, title: "Incoming message", date: `${day()}T12:00:00Z` }],
});

test.beforeEach(async ({ page, request }) => {
    await reset(request, seed());
    await login(page);
});

for (const route of ["/dashboard", "/analytics", "/leads/1"]) {
    for (const table of ["leads", "tasks", "notifications"]) {
        test(`${route} recovers after ${table} reads fail without displaying empty data`, async ({ page, request }) => {
            // Persistent until reset, so parallel topbar reads cannot consume the failure.
            expect((await request.post(`${backendURL}/__test__/fail-next`, {
                data: { table, method: "GET", count: 100 },
            })).ok()).toBe(true);
            await page.goto(route);
            const main = page.getByRole("main");
            const alert = main.getByRole("alert");
            await expect(alert).toContainText("Unable to load");
            await expect(main.getByText("Lead Not Found", { exact: true })).toHaveCount(0);
            await expect(main.getByText("No tasks scheduled for today.")).toHaveCount(0);
            await expect(main.getByText("Recent Activity", { exact: true })).toHaveCount(0);
            await reset(request, seed());
            await alert.getByRole("button", { name: "Try again" }).click();
            await expect(main.getByRole("alert")).toHaveCount(0);
            await expect(main.getByText(route === "/analytics" ? "Sales Closing Rate Trend" :
                route === "/dashboard" ? "Priority Action Center" : "Journey Customer", { exact: true }).first()).toBeVisible();
        });
    }
}

test("leads list and vehicle hydration failures have a working retry", async ({ page, request }) => {
    for (const table of ["leads", "lead_vehicle_interests"]) {
        expect((await request.post(`${backendURL}/__test__/fail-next`, {
            data: { table, method: "GET", count: 100 },
        })).ok()).toBe(true);
        await page.goto("/leads");
        const main = page.getByRole("main");
        await expect(main.getByRole("alert")).toContainText("Unable to load leads", { timeout: 15000 });
        await expect(main.getByRole("table")).toHaveCount(0);
        await reset(request, seed());
        await main.getByRole("button", { name: "Try again" }).click();
        await expect(main.getByRole("table")).toBeVisible();
        await expect(main.getByText("Journey Customer")).toBeVisible();
    }
});

test("agenda failure does not create tasks or masquerade as a free day", async ({ page, request }) => {
    expect((await request.post(`${backendURL}/__test__/fail-next`, {
        data: { table: "tasks", method: "GET", count: 100 },
    })).ok()).toBe(true);
    await page.goto("/agenda");
    const main = page.getByRole("main");
    await expect(main.getByRole("alert")).toContainText("Unable to load agenda", { timeout: 15000 });
    await expect(main.getByText("No activities for this date.")).toHaveCount(0);
    expect((await state(request)).tasks).toHaveLength(1);
    await reset(request, seed());
    await main.getByRole("button", { name: "Try again" }).click();
    await expect(main.getByText("Call customer", { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("alert")).toHaveCount(0);
});

test("a successful missing-lead response still displays not found", async ({ page }) => {
    await page.goto("/leads/99999");
    await expect(page.getByText("Lead Not Found", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
