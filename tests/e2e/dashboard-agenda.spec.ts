import { test, expect, type Page } from "@playwright/test";
import { day, failNext, lead, login, refreshed, reset, state, task } from "./fixtures/journeys";

function card(page: Page, title: string) {
    return page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("E2E-DASH-01: daily metrics, date partitions, completion failure and cross-page persistence", async ({ page, request }) => {
    await reset(request, {
        leads: [lead({ stage: "NEGOTIATION" }), lead({ lead_id: 2, first_name: "Closed", stage: "CLOSED", status: false })],
        tasks: [task(10, "Today follow-up"), task(11, "Already done", 0, true), task(12, "Yesterday follow-up", -1), task(13, "Tomorrow follow-up", 1)],
    });
    await login(page);
    const metric = (description: string) => page.getByText(description, { exact: true }).locator("..").getByRole("heading");
    await expect(metric("Scheduled work due today")).toHaveText("2");
    await expect(metric("Missed or past-due scheduled actions")).toHaveText("1");
    await expect(metric("Need immediate attention today")).toHaveText("1");
    await expect(card(page, "Yesterday follow-up")).toHaveCount(0);
    await expect(card(page, "Tomorrow follow-up")).toHaveCount(0);
    await expect(page.getByRole("article").getByRole("heading")).toHaveText(["Today follow-up", "Already done"]);
    const today = card(page, "Today follow-up");
    await failNext(request, "tasks", "PATCH");
    await today.getByRole("button", { name: "Mark Today follow-up as completed", exact: true }).click();
    await expect(today.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    expect((await state(request)).tasks.find((row: { task_id: number }) => row.task_id === 10).completed).toBe(false);
    await refreshed(page, () => today.getByRole("button", { name: "Mark Today follow-up as completed", exact: true }).click());
    await expect(today.getByRole("button", { name: "Mark Today follow-up as uncompleted", exact: true })).toBeEnabled();
    await expect(page).toHaveURL("/dashboard");
    await page.reload();
    await expect(today.getByRole("button", { name: "Mark Today follow-up as uncompleted", exact: true })).toBeVisible();
    await today.getByRole("link").click();
    await expect(page).toHaveURL("/leads/1");
    const detailTask = page.getByText("Today follow-up", { exact: true }).locator("../..");
    await expect(detailTask.getByRole("button", { name: "Completed", exact: true })).toBeVisible();
    await page.goto("/agenda");
    await expect(card(page, "Today follow-up").getByRole("button", { name: "Mark task as uncompleted", exact: true })).toBeVisible();
});

test("E2E-AGENDA-01: validate lead and type, search, fail creation, retry and navigate dates", async ({ page, request }) => {
    await reset(request, { leads: [lead()] });
    await login(page);
    await page.goto("/agenda");
    await expect(page.getByText("Loading activities...", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add Task", exact: true }).click();
    await expect(page.getByText("Select a lead before creating the task.", { exact: true })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Lead", exact: true });
    await search.fill("JOURNEY@EXAMPLE.TEST");
    await page.getByRole("button", { name: /Journey Customer.*journey@example.test/ }).click();
    await page.getByRole("button", { name: "Add Task", exact: true }).click();
    await expect(page.getByText("Select a task type before creating the task.", { exact: true })).toBeVisible();
    await page.getByLabel("Task type", { exact: true }).selectOption("Appointment");
    await page.getByLabel("Task date", { exact: true }).fill(day(1));
    await page.getByLabel("Task time", { exact: true }).fill("15:20");
    await page.getByPlaceholder("Customer request or follow-up notes").fill("Synthetic appointment notes");
    const before = (await state(request)).tasks.length;
    await failNext(request, "tasks", "POST");
    await page.getByRole("button", { name: "Add Task", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Task type", { exact: true })).toHaveValue("Appointment");
    expect((await state(request)).tasks).toHaveLength(before);
    await page.getByRole("button", { name: "Add Task", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(card(page, "Appointment")).toHaveCount(0);
    await page.getByLabel("Agenda date", { exact: true }).fill(day(1));
    const appointment = card(page, "Appointment");
    await expect(appointment).toBeVisible();
    await expect(appointment.getByText("Synthetic appointment notes", { exact: true })).toBeVisible();
    await expect(appointment).toContainText(/3:20/);
    const saved = (await state(request)).tasks.filter((row: { title: string }) => row.title === "Appointment");
    expect(saved).toEqual([expect.objectContaining({ lead_id: 1, task_date: `${day(1)}T15:20:00`, completed: false })]);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(appointment).toBeVisible();
    await page.getByRole("button", { name: "Back to Today", exact: true }).click();
    await expect(appointment).toHaveCount(0);
    await page.reload();
    await page.getByLabel("Agenda date", { exact: true }).fill(day(1));
    await expect(appointment).toBeVisible();
    await appointment.getByRole("link").click();
    await expect(page).toHaveURL("/leads/1");
    await expect(page.getByText("Synthetic appointment notes", { exact: true })).toBeVisible();
});

test("E2E-AGENDA-02: failed completion preserves state; complete and reopen survive reload", async ({ page, request }) => {
    await reset(request, { leads: [lead()], tasks: [task(10, "Agenda follow-up", -1)] });
    await login(page);
    await page.goto("/agenda");
    await page.getByLabel("Agenda date", { exact: true }).fill(day(-1));
    const followUp = card(page, "Agenda follow-up");
    await expect(followUp.getByRole("button", { name: "Mark task as completed", exact: true })).toHaveText("Overdue");
    await failNext(request, "tasks", "PATCH");
    await followUp.getByRole("button", { name: "Mark task as completed", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    await expect(followUp.getByRole("button", { name: "Mark task as completed", exact: true })).toBeEnabled();
    expect((await state(request)).tasks.find((row: { task_id: number }) => row.task_id === 10).completed).toBe(false);
    await followUp.getByRole("button", { name: "Mark task as completed", exact: true }).click();
    await expect(followUp.getByRole("button", { name: "Mark task as uncompleted", exact: true })).toHaveText("Completed");
    await page.reload();
    await page.getByLabel("Agenda date", { exact: true }).fill(day(-1));
    await followUp.getByRole("button", { name: "Mark task as uncompleted", exact: true }).click();
    await expect(followUp.getByRole("button", { name: "Mark task as completed", exact: true })).toHaveText("Overdue");
    await page.reload();
    await page.getByLabel("Agenda date", { exact: true }).fill(day(-1));
    await expect(followUp.getByRole("button", { name: "Mark task as completed", exact: true })).toHaveText("Overdue");
    await page.goto("/dashboard");
    const overdueMetric = page.getByText("Missed or past-due scheduled actions", { exact: true }).locator("..");
    await expect(overdueMetric.getByRole("heading")).toHaveText("1");
});

test("E2E-DASH-02: empty dashboard and an empty agenda day show actionable empty states", async ({ page, request }) => {
    await reset(request);
    await login(page);
    await expect(page.getByText("No tasks scheduled for today.", { exact: true })).toBeVisible();
    await expect(page.getByText("No recent activity found.", { exact: true })).toBeVisible();
    await expect(page.getByText("Great work! There are currently no high-priority leads requiring immediate attention.", { exact: true })).toBeVisible();
    await page.goto("/agenda");
    await expect(page.getByText("No activities for this date.", { exact: true })).toBeVisible();
    await page.getByLabel("Agenda date", { exact: true }).fill(day(10));
    await expect(page.getByText("No activities for this date.", { exact: true })).toBeVisible();
    await expect(page.getByText("0 Activities", { exact: true })).toBeVisible();
});
