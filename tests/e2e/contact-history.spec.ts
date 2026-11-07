import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { backendURL } from "./fixtures/endpoints";
import { day, lead, login, reset, state } from "./fixtures/journeys";

// Browser interaction contract against the HTTP double. Actual SQL/RLS are checked separately.
test("manual incoming contact: failed save, unchanged retry, follow-up, reload and accessible form", async ({ page, request }) => {
    await reset(request, { leads: [lead({ version: 1, last_interaction_date: null })], notifications: [
        { notification_id: 4, lead_id: 1, title: "Legacy note", date: "2026-01-01T10:00:00Z" },
    ] });
    const attempts: Record<string, unknown>[] = [];
    await page.route("**/rest/v1/rpc/autotrack_record_contact", async route => {
        const input = route.request().postDataJSON(); attempts.push(input);
        if (attempts.length === 1) return route.fulfill({ status: 503, json: { message: "Synthetic contact save failure" } });
        const row = { notification_id: 201, lead_id: 1, title: "Received email: received", date: input.p_occurred_at,
            contact_direction: input.p_direction, contact_channel: input.p_channel, contact_outcome: input.p_outcome,
            contact_notes: input.p_notes, next_follow_up_at: input.p_next_follow_up_at, contact_request_id: input.p_request_id };
        const tables = await state(request);
        tables.notifications.push(row);
        Object.assign(tables.leads[0], { last_interaction_date: input.p_occurred_at, last_interaction_by: "LEAD", follow_up_date: input.p_next_follow_up_at, version: 2 });
        tables.tasks.push({ task_id: 202, lead_id: 1, title: "Contact follow-up #201", task_type: "Follow-up",
            notes: input.p_notes, task_date: `${day(1)}T09:00:00`, completed: false });
        await request.post(`${backendURL}/__test__/reset`, { data: tables });
        await route.fulfill({ status: 200, json: row });
    });
    await login(page); await page.goto("/leads/1");
    await expect(page.getByRole("heading", { name: "Contact history", exact: true })).toBeVisible();
    await expect(page.getByText("Legacy note", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log contact", exact: true }).click();
    await page.getByRole("combobox", { name: "Contact direction" }).click();
    await page.getByRole("option", { name: "Incoming", exact: true }).click();
    await page.getByRole("combobox", { name: "Contact channel" }).click();
    await page.getByRole("option", { name: "Email", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Contact result" }).locator('[data-slot="select-value"]')).toHaveText("Received");
    await page.getByLabel("Contact date", { exact: true }).fill(day(-1));
    await page.getByLabel("Contact time", { exact: true }).fill("10:00");
    await page.getByLabel("Contact notes", { exact: true }).fill("Quote requested. <script>literal</script>");
    await page.getByLabel("Contact next follow-up date", { exact: true }).fill(day(1));
    await page.getByLabel("Contact next follow-up time", { exact: true }).fill("09:00");
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("contact-form.png") });
    await page.getByRole("button", { name: "Save contact", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Synthetic contact save failure");
    await expect(page.getByLabel("Contact notes", { exact: true })).toHaveValue("Quote requested. <script>literal</script>");
    await page.getByRole("button", { name: "Save contact", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Incoming · Email · Received", { exact: true })).toBeVisible();
    await expect(page.getByText("Contact follow-up #201", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[1]).toMatchObject({ p_direction: "inbound", p_channel: "email", p_outcome: "received", p_time_zone: "America/Toronto" });
    await page.reload();
    await expect(page.getByText("Incoming · Email · Received", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy note", { exact: true })).toBeVisible();
    const tables = await state(request);
    expect(tables.notifications).toHaveLength(2); expect(tables.tasks).toHaveLength(1);
    expect(tables.notifications[1]).not.toHaveProperty("replied_at");
});
