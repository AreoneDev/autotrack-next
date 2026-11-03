import { test, expect } from "@playwright/test";
import { day, failNext, lead, login, refreshed, reset, state } from "./fixtures/journeys";

test("E2E-TASK-01: validate, create, edit, complete, reopen and delete with failure recovery", async ({ page, request }) => {
    await reset(request, { leads: [lead()] });
    await login(page);
    await page.goto("/leads/1");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Task type is required.", { exact: true })).toBeVisible();
    expect((await state(request)).tasks).toHaveLength(0);
    await page.getByLabel("New task type", { exact: true }).selectOption("Follow-up");
    await page.getByLabel("New task date", { exact: true }).fill(day(2));
    await page.getByLabel("New task time", { exact: true }).fill("14:45");
    await page.getByPlaceholder("Short notes or description", { exact: true }).fill("Confirm preferred vehicle.");
    await failNext(request, "tasks", "POST");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    await expect(page.getByLabel("New task type", { exact: true })).toHaveValue("Follow-up");
    expect((await state(request)).tasks).toHaveLength(0);
    await refreshed(page, () => page.getByRole("button", { name: "Add", exact: true }).click());
    await expect(page.getByText("Confirm preferred vehicle.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Confirm preferred vehicle.", { exact: true })).toBeVisible();
    expect((await state(request)).tasks).toEqual([expect.objectContaining({
        title: "Follow-up", completed: false, task_date: `${day(2)}T14:45:00`,
    })]);

    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await page.getByLabel("Task title", { exact: true }).fill(" ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Task title is required.", { exact: true })).toBeVisible();
    await page.getByLabel("Task title", { exact: true }).fill("Confirm quotation");
    await page.getByLabel("Task notes", { exact: true }).fill("Bring updated pricing.");
    await page.getByLabel("Task date", { exact: true }).fill(day(3));
    await page.getByLabel("Task time", { exact: true }).fill("23:45");
    await failNext(request, "tasks", "PATCH");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    expect((await state(request)).tasks[0].title).toBe("Follow-up");
    await refreshed(page, () => page.getByRole("button", { name: "Save", exact: true }).click());
    await expect(page.getByText("Confirm quotation", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue("Confirm quotation");
    await expect(page.getByLabel("Task notes", { exact: true })).toHaveValue("Bring updated pricing.");
    await expect(page.getByLabel("Task date", { exact: true })).toHaveValue(day(3));
    await expect(page.getByLabel("Task time", { exact: true })).toHaveValue("23:45");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await failNext(request, "tasks", "PATCH");
    await page.getByRole("button", { name: "Uncompleted", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uncompleted", exact: true })).toBeEnabled();
    expect((await state(request)).tasks[0].completed).toBe(false);
    await refreshed(page, () => page.getByRole("button", { name: "Uncompleted", exact: true }).click());
    await expect(page.getByRole("button", { name: "Completed", exact: true })).toBeEnabled();
    await page.reload();
    await refreshed(page, () => page.getByRole("button", { name: "Completed", exact: true }).click());
    await expect(page.getByRole("button", { name: "Uncompleted", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "Uncompleted", exact: true })).toBeVisible();

    await failNext(request, "tasks", "DELETE");
    await page.getByRole("button", { name: "Delete task", exact: true }).click();
    await expect(page.getByText("Synthetic write failure", { exact: true })).toBeVisible();
    expect((await state(request)).tasks).toHaveLength(1);
    await refreshed(page, () => page.getByRole("button", { name: "Delete task", exact: true }).click());
    await expect(page.getByText("No tasks for this lead.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Confirm quotation", { exact: true })).toHaveCount(0);
    expect((await state(request)).tasks).toHaveLength(0);
});
