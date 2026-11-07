import { test, expect } from "@playwright/test";
import { day, failNext, lead, login, refreshed, reset, state } from "./fixtures/journeys";

test.beforeEach(async ({ page, request }) => {
    await reset(request, { leads: [lead({ last_interaction_date: new Date(Date.now() - 60_000).toISOString() })] });
    await login(page);
    await page.goto("/leads/1");
    await expect(page.getByRole("heading", { name: "Journey Customer", exact: true })).toBeVisible();
});

test("E2E-DETAIL-01: cancel, failed save, retry and reload preserve lead fields", async ({ page, request }) => {
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await page.getByLabel("First Name", { exact: true }).fill("Discarded");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Journey Customer", exact: true })).toBeVisible();
    expect((await state(request)).leads[0].first_name).toBe("Journey");

    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await page.getByLabel("First Name", { exact: true }).fill("Updated");
    await page.getByLabel("Email", { exact: true }).fill("updated@example.test");
    await page.getByLabel("Phone", { exact: true }).fill("4165550199");
    await page.getByLabel("Budget", { exact: true }).fill("42000");
    await page.getByRole("combobox", { name: "Stage", exact: true }).click();
    await page.getByRole("option", { name: "NEGOTIATION", exact: true }).click();
    await page.getByLabel("Follow-up Date", { exact: true }).fill(day(3));
    await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Customer requested a quotation.");
    await failNext(request, "leads", "PATCH");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Updated");
    expect((await state(request)).leads[0]).toMatchObject({ first_name: "Journey", budget: 35000, stage: "CONTACTED" });
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    await expect(page.getByRole("heading", { name: "Updated Customer", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("updated@example.test", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Updated");
    await expect(page.getByLabel("Phone", { exact: true })).toHaveValue("4165550199");
    await expect(page.getByLabel("Budget", { exact: true })).toHaveValue("42000");
    await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toContainText("NEGOTIATION");
    await expect(page.getByLabel("Follow-up Date", { exact: true })).toHaveValue(day(3));
    await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("Customer requested a quotation.");
    expect((await state(request)).leads).toHaveLength(1);
    await page.getByRole("combobox", { name: "Stage", exact: true }).click();
    await page.getByRole("option", { name: "CLOSED", exact: true }).click();
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    await expect(page.getByRole("button", { name: "Modify", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Closed (outcome unconfirmed)", { exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({ stage: "CLOSED", status: false, first_name: "Updated" });
});

test("E2E-DETAIL-02: communication failure and retry persist in detail, dashboard and agenda", async ({ page, request }) => {
    const original = (await state(request)).leads[0];
    await failNext(request, "notifications", "POST");
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    expect((await state(request)).notifications).toHaveLength(0);
    expect((await state(request)).leads[0]).toEqual(original);
    await refreshed(page, () => page.getByRole("button", { name: "Call", exact: true }).click());
    const title = "You called Journey Customer";
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect((await state(request)).notifications).toHaveLength(1);
    const saved = await state(request);
    expect(saved.leads[0]).toMatchObject({ last_interaction_by: "USER", score: 35,
        last_interaction_date: saved.notifications[0].date });
    expect(saved.leads[0].last_interaction_date).toContain("T");
    await page.goto("/dashboard");
    const activity = page.getByRole("link").filter({ hasText: title });
    await expect(activity).toBeVisible();
    await activity.click();
    await expect(page).toHaveURL("/leads/1");
    await page.goto("/agenda");
    await expect(page.getByRole("article").filter({ hasText: title })).toBeVisible();
});

test("communication replay after a lost response and reload does not duplicate or regress state", async ({ page, request }) => {
    const endpoint = "**/rest/v1/rpc/autotrack_log_communication";
    await page.route(endpoint, async (route) => {
        await route.fetch(); // Commit successfully, then lose the browser response.
        await route.abort("failed");
    });
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await expect.poll(async () => (await state(request)).notifications.length).toBe(1);
    await expect(page.getByRole("button", { name: "Call", exact: true })).toBeEnabled();
    const committed = await state(request);
    await page.unroute(endpoint);
    await page.reload();
    await refreshed(page, () => page.getByRole("button", { name: "Call", exact: true }).click());
    const replayed = await state(request);
    expect(replayed.notifications).toEqual(committed.notifications);
    expect(replayed.leads).toEqual(committed.leads);
    await expect(page.getByText("You called Journey Customer", { exact: true })).toHaveCount(1);
});

test("email and message update contact metadata without changing manual follow-up or lead details", async ({ page, request }) => {
    const original = (await state(request)).leads[0];
    for (const channel of ["Email", "Message"]) {
        await refreshed(page, () => page.getByRole("button", { name: channel, exact: true }).click());
        const saved = await state(request);
        expect(saved.leads[0]).toMatchObject({ last_interaction_by: "USER", score: 35,
            stage: original.stage, notes: original.notes, follow_up_date: original.follow_up_date });
        expect(saved.leads[0].last_interaction_date).toBe(saved.notifications.at(-1)?.date);
    }
    await page.reload();
    expect((await state(request)).notifications).toHaveLength(2);
    await expect(page.getByText("You sent an email to Journey Customer", { exact: true })).toBeVisible();
    await expect(page.getByText("You sent a message to Journey Customer", { exact: true })).toBeVisible();
    const contactTime = (await state(request)).leads[0].last_interaction_date;
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await page.getByLabel("Phone", { exact: true }).fill("4165550123");
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    expect((await state(request)).leads[0].last_interaction_date).toBe(contactTime);
});

test("E2E-DETAIL-03: unknown lead offers a working route back to the list", async ({ page }) => {
    await page.goto("/leads/999999");
    await expect(page.getByRole("heading", { name: "Lead Not Found", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Leads", exact: true }).click();
    await expect(page).toHaveURL("/leads");
    await expect(page.getByRole("link", { name: "Journey Customer", exact: true })).toBeVisible();
});

for (const table of ["lead_vehicle_interests", "lead_trade_in_vehicles"]) {
    test(`vehicle association failure after lead update: ${table}`, async ({ page, request }) => {
        await page.getByRole("button", { name: "Modify", exact: true }).click();
        await page.getByLabel("First Name", { exact: true }).fill("Partially Saved");
        await failNext(request, table, "DELETE");
        await page.getByRole("button", { name: "Save Changes", exact: true }).click();

        await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
        await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Partially Saved");
        expect((await state(request)).leads[0].first_name).toBe("Partially Saved");
        await page.reload();
        await expect(page.getByRole("heading", { name: "Partially Saved Customer", exact: true })).toBeVisible();
    });
}
