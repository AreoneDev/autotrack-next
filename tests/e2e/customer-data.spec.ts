import { expect, test } from "@playwright/test";
import { login, reset } from "./fixtures/journeys";

test("recovery setup failure is actionable and refresh works after setup is repaired", async ({ page, request }) => {
    await reset(request, {});
    await login(page);
    let available = false;
    await page.route(/\/rest\/v1\/lead_recovery_snapshots(?:\?|$)/, async route => {
        expect(route.request().method()).toBe("GET");
        await route.fulfill({
            status: available ? 200 : 404,
            contentType: "application/json",
            body: JSON.stringify(available ? [{
                recovery_id: "11111111-1111-4111-8111-111111111111",
                lead_id: "9007199254740993", deleted_at: "2026-11-07T12:00:00Z",
                snapshot: { lead: { first_name: "Synthetic", last_name: "Customer" }, tasks: [], notifications: [] },
            }] : {
                code: "PGRST205", details: null, hint: null,
                message: "Could not find the table 'public.lead_recovery_snapshots' in the schema cache",
            }),
        });
    });
    await page.goto("/data");
    const main = page.getByRole("main");
    await expect(main.getByRole("alert")).toHaveText(
        "Deleted customer recovery is unavailable. Ask an administrator to verify its database setup.",
    );
    await expect(main.getByText("No deleted customers to restore.")).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Restore customer/ })).toHaveCount(0);
    available = true;
    await main.getByRole("button", { name: "Refresh deleted customers" }).click();
    await expect(main.getByRole("alert")).toHaveCount(0);
    await expect(main.getByText("Synthetic Customer", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Restore customer #9007199254740993" })).toBeVisible();
});
