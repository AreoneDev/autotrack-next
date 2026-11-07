import { test, expect, type Page } from "@playwright/test";
import { day, failNext, lead, login, refreshed, reset, state, task } from "./fixtures/journeys";

const closedLabel = "Closed (outcome unconfirmed)";

async function chooseStage(page: Page, stage: string) {
    await page.getByRole("combobox", { name: "Stage", exact: true }).click();
    await page.getByRole("option", { name: stage, exact: true }).click();
}

test("legacy outcomes agree across list, detail, analytics and automatic agenda", async ({ page, request }) => {
    await reset(request, {
        leads: [
            lead({ first_name: "Won", stage: " delivered ", status: false, score: 200, follow_up_date: `${day()}T09:00:00` }),
            lead({ lead_id: 2, first_name: "Unconfirmed", stage: " closed ", status: true, score: 200, follow_up_date: `${day()}T09:00:00` }),
            lead({ lead_id: 3, first_name: "Lost", stage: "NEGOTIATION", status: false, score: 200, follow_up_date: `${day()}T09:00:00` }),
            lead({ lead_id: 4, first_name: "Open", stage: "NEW", status: true }),
        ],
        tasks: [task(10, "Existing manual task")],
    });
    await login(page);
    await page.goto("/leads");
    const wonStatus = page.getByRole("combobox", { name: "Status for Won Customer", exact: true });
    await expect(wonStatus).toContainText("Delivered");
    await expect(wonStatus).toBeDisabled();
    await expect(page.getByRole("combobox", { name: "Status for Unconfirmed Customer", exact: true })).toContainText(closedLabel);
    await expect(page.getByRole("combobox", { name: "Status for Lost Customer", exact: true })).toContainText("Lost");
    await page.getByRole("combobox", { name: "Filter by status", exact: true }).click();
    await page.getByRole("option", { name: "Active", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open Customer", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Won Customer", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Unconfirmed Customer", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Lost Customer", exact: true })).toHaveCount(0);
    await page.goto("/leads/2");
    await expect(page.getByText(closedLabel, { exact: true })).toBeVisible();
    await page.goto("/analytics");
    const metric = page.getByText("Deals Closing Rate", { exact: true }).locator("../../..");
    await expect(metric.getByRole("heading", { name: "25%", exact: true })).toBeVisible();
    await expect(metric.getByText("1/4", { exact: true })).toBeVisible();
    await page.goto("/agenda");
    await expect(page.getByRole("article").filter({ hasText: "Existing manual task" })).toBeVisible();
    const saved = await state(request);
    expect(saved.tasks.filter((row: { lead_id: number; task_id: number }) => row.lead_id !== 4 && row.task_id !== 10)).toEqual([]);
    // Read-time compatibility does not rewrite legacy stage, status or stored scores.
    expect(saved.leads[0]).toMatchObject({ stage: " delivered ", status: false, score: 200 });
    expect(saved.leads[1]).toMatchObject({ stage: " closed ", status: true, score: 200 });
});

test("resolve CLOSED as delivered, retry a failed save, reopen explicitly and mark lost", async ({ page, request }) => {
    await reset(request, { leads: [lead({ stage: "CLOSED", status: false, score: 200 })] });
    await login(page);
    await page.goto("/leads/1");
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeDisabled();
    await chooseStage(page, "DELIVERED");
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toContainText("Delivered");
    await failNext(request, "leads", "PATCH");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({ stage: "CLOSED", status: false });
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    await page.reload();
    await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({ stage: "DELIVERED", status: false, score: 0 });
    await page.goto("/analytics");
    const metric = page.getByText("Deals Closing Rate", { exact: true }).locator("../../..");
    await expect(metric.getByRole("heading", { name: "100%", exact: true })).toBeVisible();
    await page.goto("/leads/1");
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await chooseStage(page, "CONTACTED");
    const status = page.getByRole("combobox", { name: "Status", exact: true });
    await expect(status).toBeEnabled();
    await expect(status).toContainText("Active");
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    await page.reload();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({ stage: "CONTACTED", status: true });
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await status.click();
    await page.getByRole("option", { name: "Lost", exact: true }).click();
    await refreshed(page, () => page.getByRole("button", { name: "Save Changes", exact: true }).click());
    await page.reload();
    await expect(page.getByText("Lost", { exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({ stage: "CONTACTED", status: false, score: 0 });
    await page.goto("/analytics");
    await expect(metric.getByRole("heading", { name: "0%", exact: true })).toBeVisible();
});
