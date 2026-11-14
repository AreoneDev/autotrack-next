import { backendURL } from "./fixtures/endpoints";
import { test, expect } from "@playwright/test";
import { failNext, lead, login, reset, state, task } from "./fixtures/journeys";

test("E2E-LEAD-01: create → search → change status → reload → delete", async ({ page, request }) => {
    expect((await request.post(`${backendURL}/__test__/reset`)).ok()).toBe(true);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    await page.goto("/leads");
    await page.getByRole("button", { name: "Create new lead" }).click();
    await page.getByLabel("First Name", { exact: true }).fill("Browser");
    await page.getByLabel("Last Name", { exact: true }).fill("Customer");
    await page.getByLabel("Email", { exact: true }).fill("browser@example.test");
    await page.getByRole("button", { name: "Create Lead", exact: true }).click();
    const customer = page.getByRole("link", { name: "Browser Customer", exact: true });
    await expect(customer).toBeVisible();
    const search = page.getByPlaceholder("Search by customer name, email, or phone");
    await search.fill("missing customer");
    await expect(page.getByText("No leads match the selected filters.")).toBeVisible();
    await search.fill("BROWSER@EXAMPLE.TEST");
    await expect(customer).toBeVisible();
    const row = page.getByRole("row").filter({ has: customer });
    if (test.info().project.name === "mobile-chromium") {
        await row.getByRole("button", { name: "More details for Browser Customer" }).click();
    }
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Lost", exact: true }).click();
    await expect(row.getByRole("combobox")).toBeEnabled();
    await page.reload();
    await expect(row.getByRole("combobox")).toContainText("Lost");
    if (test.info().project.name === "mobile-chromium") {
        await row.getByRole("button", { name: "More details for Browser Customer" }).click();
    }
    await row.getByRole("button", { name: "Delete Lead" }).click();
    await expect(customer).toHaveCount(0);
    await page.reload();
    await expect(customer).toHaveCount(0);
    await expect(page.getByText("No leads yet. Create a lead to get started.")).toBeVisible();
});


test("E2E-LEAD-02: dependent customer deletion keeps data on error and removes only its graph on retry", async ({ page, request }) => {
    await reset(request, {
        leads: [lead(), lead({ lead_id: 2, first_name: "Keep" })],
        tasks: [task(1, "Delete task"), { ...task(2, "Keep task"), lead_id: 2 }],
        notifications: [{ notification_id: 1, lead_id: 1, title: "Delete notification" }, { notification_id: 2, lead_id: null, title: "Keep standalone" }],
        vehicles: [{ vehicle_id: 1, make: "Synthetic", model: "Shared", year: 2026 }],
        lead_vehicle_interests: [{ lead_id: 1, vehicle_id: 1 }, { lead_id: 2, vehicle_id: 1 }],
        lead_trade_in_vehicles: [{ lead_id: 1, vehicle_id: 1 }],
    });
    await login(page);
    await page.goto("/leads");
    const before = await state(request);
    const customer = page.getByRole("link", { name: "Journey Customer", exact: true });
    if (test.info().project.name === "mobile-chromium") {
        await page.getByRole("row").filter({ has: customer }).getByRole("button", { name: "More details for Journey Customer" }).click();
    }
    const remove = page.getByRole("row").filter({ has: customer }).getByRole("button", { name: "Delete Lead" });
    await failNext(request, "leads", "DELETE");
    await remove.click();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic write failure" })).toBeVisible();
    await expect(customer).toBeVisible();
    await expect(remove).toBeEnabled();
    expect(await state(request)).toEqual(before);
    await remove.click();
    await expect(customer).toHaveCount(0);
    const after = await state(request);
    for (const table of ["leads", "tasks", "notifications", "lead_vehicle_interests", "lead_trade_in_vehicles"]) {
        expect(after[table]).toEqual(before[table].filter((row: { lead_id?: number }) => row.lead_id !== 1));
    }
    expect(after.vehicles).toEqual(before.vehicles);
    await page.reload();
    await expect(customer).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Keep Customer", exact: true })).toBeVisible();
});

test("work filters use due incomplete tasks and pending incoming contacts, and pagination resets", async ({ page, request }) => {
    await reset(request, {
        leads: Array.from({ length: 30 }, (_, index) => lead({ lead_id: index + 1, first_name: `Lead${index + 1}`, status: index !== 1 })),
        tasks: [task(1, "Due", -1), { ...task(2, "Inactive due", -1), lead_id: 2 }, { ...task(3, "Future", 1), lead_id: 3 }, { ...task(4, "Completed", -1, true), lead_id: 4 }],
        notifications: [
            { notification_id: 1, lead_id: 1, title: "Incoming", date: "2020-01-01T12:00:00Z", contact_direction: "inbound", replied_at: null },
            { notification_id: 2, lead_id: 3, title: "Replied", date: "2020-01-01T12:00:00Z", contact_direction: "inbound", replied_at: "2020-01-02T12:00:00Z" },
            { notification_id: 3, lead_id: 4, title: "Outbound", date: "2020-01-01T12:00:00Z", contact_direction: "outbound", replied_at: null },
        ],
    });
    await login(page);
    await page.goto("/leads");
    await expect(page.getByText("1–25 of 30 leads")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("26–30 of 30 leads")).toBeVisible();
    await page.getByRole("button", { name: /More filters/ }).click();
    const followUp = page.getByRole("checkbox", { name: "Follow-up due through today" });
    const unreplied = page.getByRole("checkbox", { name: "Unreplied customer contact" });
    await expect(followUp).toBeEnabled();
    await expect(unreplied).toBeEnabled();
    await followUp.check();
    await expect(page.getByRole("link", { name: "Lead1 Customer", exact: true })).toBeVisible();
    await expect(page.getByText("1–1 of 1 leads")).toBeVisible();
    await unreplied.check();
    await expect(page.getByText("1–1 of 1 leads")).toBeVisible();
    await followUp.uncheck();
    await expect(page.getByText("1–1 of 1 leads")).toBeVisible();
    await page.getByRole("button", { name: "Clear Filters" }).click();
    await expect(page.getByText("1–25 of 30 leads")).toBeVisible();
});

test("responsive leads layout keeps controls usable and details accessible", async ({ page, request }, info) => {
    test.skip(info.project.name !== "chromium", "Checks desktop and narrow widths in one browser");
    await reset(request, { leads: [lead({ first_name: "Alexandra", last_name: "Customer", lead_email: "a.very.long.customer.address@example.test" })] });
    await login(page);
    await page.setViewportSize({ width: 1920, height: 869 });
    await page.goto("/leads");
    const firstRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Alexandra Customer" }) });
    await expect(firstRow).toBeVisible();
    const rowBox = await firstRow.boundingBox();
    expect(rowBox!.y + rowBox!.height).toBeLessThan(869);
    await page.screenshot({ path: info.outputPath("leads-desktop.png") });
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(page.getByRole("button", { name: "More details for Alexandra Customer" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("leads-mobile.png") });
    await page.getByRole("button", { name: "More details for Alexandra Customer" }).click();
    await expect(page.getByRole("button", { name: "Delete Lead Alexandra Customer" })).toBeVisible();
    await page.getByRole("button", { name: /More filters/ }).click();
    await expect(page.getByRole("checkbox", { name: "Follow-up due through today" })).toBeVisible();
    const main = page.locator("#main-content");
    expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("leads-mobile-expanded.png") });
});
