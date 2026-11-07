import { test, expect } from "@playwright/test";
import { lead, login, reset, state } from "./fixtures/journeys";

test("new customer validates fields, reviews duplicates, and persists canonical contacts", async ({ page, request }) => {
    await reset(request, { leads: [lead({ lead_email: " SHARED@EXAMPLE.TEST ", phone: "(416) 555-0100" })] });
    await login(page); await page.goto("/leads");
    await page.getByRole("button", { name: "Create new lead" }).click();
    await page.getByLabel("First Name", { exact: true }).fill("Separate");
    await page.getByLabel("Email", { exact: true }).fill("bad");
    await page.getByLabel("Phone", { exact: true }).fill("123");
    await page.getByLabel("Budget", { exact: true }).fill("-20");
    await page.getByRole("button", { name: "Create Lead", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(3);
    expect((await state(request)).leads).toHaveLength(1);
    await page.getByLabel("Email", { exact: true }).fill(" SHARED@EXAMPLE.TEST ");
    await page.getByLabel("Phone", { exact: true }).fill("416-555-0100");
    await page.getByLabel("Budget", { exact: true }).fill("42000.25");
    await page.getByRole("button", { name: "Create Lead", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Possible duplicate customers");
    await expect(page.getByRole("dialog").getByRole("link", { name: "Journey Customer" })).toHaveAttribute("href", "/leads/1");
    expect((await state(request)).leads).toHaveLength(1);
    await page.getByRole("button", { name: "Create Anyway", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await state(request)).leads[1]).toMatchObject({
        lead_email: "shared@example.test", phone: "+14165550100", budget: 42000.25,
    });
    await page.reload();
    await expect(page.getByRole("link", { name: "Separate", exact: true })).toBeVisible();
});

test("legacy invalid fields permit unrelated edits and changed contact fields require review", async ({ page, request }) => {
    await reset(request, { leads: [
        lead({ phone: "legacy extension", lead_email: "unknown", budget: -5 }),
        lead({ lead_id: 2, first_name: "Existing", phone: "4165550199", lead_email: "existing@example.test" }),
    ] });
    await login(page); await page.goto("/leads/1");
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await page.getByLabel("First Name", { exact: true }).fill("Renamed");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Modify", exact: true })).toBeVisible();
    expect((await state(request)).leads[0]).toMatchObject({
        first_name: "Renamed", phone: "legacy extension", lead_email: "unknown", budget: -5,
    });
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await page.getByLabel("Budget", { exact: true }).fill("invalid");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByLabel("Budget", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Budget", { exact: true }).fill("0");
    await page.getByLabel("Phone", { exact: true }).fill("+1 (416) 555-0199");
    await page.getByLabel("Email", { exact: true }).fill(" EXISTING@EXAMPLE.TEST ");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Possible duplicate customers");
    expect((await state(request)).leads[0].phone).toBe("legacy extension");
    await page.getByRole("button", { name: "Save Anyway", exact: true }).click();
    await expect(page.getByRole("button", { name: "Modify", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("+14165550199", { exact: true })).toBeVisible();
    await expect(page.getByText("existing@example.test", { exact: true })).toBeVisible();
});
