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
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Lost", exact: true }).click();
    await expect(row.getByRole("combobox")).toBeEnabled();
    await page.reload();
    await expect(row.getByRole("combobox")).toContainText("Lost");
    await row.getByRole("button", { name: "Delete Lead" }).click();
    await expect(customer).toHaveCount(0);
    await page.reload();
    await expect(customer).toHaveCount(0);
    await expect(page.getByText("No leads match the selected filters.")).toBeVisible();
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
