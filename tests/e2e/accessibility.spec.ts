import { refreshed } from "./fixtures/journeys";
import { backendURL } from "./fixtures/endpoints";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe.configure({ timeout: 60000 });

async function scan(page: Page, info: TestInfo, name: string) {
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
    await info.attach(`axe-${name}`, { body: JSON.stringify(results, null, 2), contentType: "application/json" });
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
}

async function createLead(page: Page) {
    await page.goto("/leads");
    await page.getByRole("button", { name: "Create new lead" }).click();
    await page.getByLabel("First Name", { exact: true }).fill("A11y");
    await page.getByLabel("Last Name", { exact: true }).fill("Customer");
    await refreshed(page, () => page.getByRole("button", { name: "Create Lead", exact: true }).click());
    await expect(page.getByRole("link", { name: "A11y Customer", exact: true })).toBeVisible();
}

async function createTask(page: Page) {
    await page.getByRole("link", { name: "A11y Customer", exact: true }).click();
    await page.getByRole("combobox", { name: "New task type", exact: true }).selectOption("Follow-up");
    await page.getByLabel("New task notes", { exact: true }).fill("Synthetic accessibility task");
    await refreshed(page, () => page.getByRole("button", { name: "Add", exact: true }).click());
    await expect(page.getByRole("button", { name: "Edit task Follow-up", exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
    expect((await request.post(`${backendURL}/__test__/reset`)).ok()).toBe(true);
});

test("A11Y-01: login modes, announced error and keyboard submission", async ({ page }, info) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Password", exact: true })).toBeEnabled();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Password", exact: true })).toBeFocused();
    for (const mode of ["Register", "Email link", "Password"]) {
        await page.getByRole("button", { name: mode, exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
        await scan(page, info, mode);
    }
    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.type("wrong@example.test");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.type("wrong-password");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid login credentials");
    await scan(page, info, "login-error");
});

test("A11Y-02: key pages, skip link, collapsed navigation and notification disclosure", async ({ page }, info) => {
    await signIn(page);
    await createLead(page);
    await createTask(page);
    for (const path of ["/leads", "/dashboard", "/agenda", "/analytics"]) {
        const name = path.slice(1, 2).toUpperCase() + path.slice(2);
        // Use the application's client navigation so a pending task refresh
        // cannot race a hard document navigation in Firefox.
        await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name, exact: true }).click();
        await expect(page).toHaveURL(path);
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: path.slice(1, 2).toUpperCase() + path.slice(2), exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.getByText(/Loading/i)).toHaveCount(0);
        await expect(page).toHaveTitle(`${path.slice(1, 2).toUpperCase() + path.slice(2)} | AutoTrack`);
        await scan(page, info, path.slice(1));
    }
    await page.goto("/leads");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await page.getByRole("button", { name: "Collapse sidebar" }).focus();
    await page.keyboard.press("Enter");
    for (const name of ["Dashboard", "Leads", "Agenda", "Analytics"]) {
        await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toBeVisible();
    }
    await scan(page, info, "collapsed-sidebar");
    const notifications = page.getByRole("button", { name: "Open notifications" });
    await notifications.focus();
    await page.keyboard.press("Enter");
    await expect(notifications).toHaveAttribute("aria-expanded", "true");
    await scan(page, info, "notifications");
    await page.keyboard.press("Escape");
    await expect(notifications).toHaveAttribute("aria-expanded", "false");
    await expect(notifications).toBeFocused();
});

test("A11Y-03: modal initial focus, both Tab boundaries, Escape and focus restoration", async ({ page }, info) => {
    await signIn(page);
    await page.goto("/leads");
    const trigger = page.getByRole("button", { name: "Create new lead" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create Lead", exact: true });
    const close = dialog.getByRole("button", { name: "Close create lead" });
    const submit = dialog.getByRole("button", { name: "Create Lead", exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("First Name", { exact: true })).toBeFocused();
    await submit.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    await scan(page, info, "create-dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await createLead(page);
    const brief = page.getByRole("button", { name: "View lead brief for A11y Customer" });
    await brief.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Close lead brief" })).toBeFocused();
    await scan(page, info, "brief-dialog");
    await page.keyboard.press("Escape");
    await expect(brief).toBeFocused();
});

test("A11Y-04: lead details, edit controls, keyboard autocomplete and safe delete cancellation", async ({ page }, info) => {
    await signIn(page); await createLead(page);
    await page.getByRole("link", { name: "A11y Customer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Modify", exact: true })).toBeVisible();
    await scan(page, info, "lead-detail");
    await page.getByRole("combobox", { name: "New task type", exact: true }).selectOption("Follow-up");
    await refreshed(page, () => page.getByRole("button", { name: "Add", exact: true }).click());
    await page.getByRole("button", { name: "Edit task Follow-up", exact: true }).click();
    await expect(page.getByLabel("Task title", { exact: true })).toBeVisible();
    await scan(page, info, "task-edit");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    // A synthetic catalog response exercises the actual client combobox widget.
    await page.route(/\/rest\/v1\/vehicles(?:\?|$)/, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({ json: [{ vehicle_id: 999, year: 2026, make: "Synthetic", model: "Access", trim: "Test" }] });
    });
    await page.getByRole("button", { name: "Modify", exact: true }).click();
    await scan(page, info, "lead-edit");
    const year = page.getByRole("group", { name: "Vehicle Interest", exact: true }).getByRole("combobox", { name: "Year", exact: true });
    await year.focus(); await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "2026", exact: true })).toBeVisible();
    await scan(page, info, "vehicle-options");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await expect(year).toHaveValue("2026");
    await expect(year).toBeFocused();
    await expect(year).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Delete", exact: true });
    await trigger.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await scan(page, info, "delete-dialog");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.goto("/leads");
    const make = page.getByRole("combobox", { name: "Filter by vehicle make" });
    await make.focus(); await page.keyboard.type("Custom"); await page.keyboard.press("Escape");
    await expect(make).toHaveValue("Custom");
    await expect(make).toHaveAttribute("aria-expanded", "false");
});

test("A11Y-05: calendar has one day tab stop and arrow keys cross month boundaries", async ({ page }, info) => {
    await signIn(page); await page.goto("/agenda");
    const date = page.getByLabel("Agenda date", { exact: true });
    await date.fill("2026-02-28");
    const calendar = page.getByRole("region", { name: "Calendar" });
    await calendar.getByRole("button", { name: /^28 February 2026/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(calendar.getByRole("button", { name: /^1 March 2026/ })).toBeFocused();
    await expect(date).toHaveValue("2026-03-01");
    await page.keyboard.press("ArrowUp");
    await expect(calendar.getByRole("button", { name: /^22 February 2026/ })).toBeFocused();
    await expect(calendar.locator('button[aria-pressed][tabindex="0"]')).toHaveCount(1);
    for (const name of ["Lead", "Task type", "Task date", "Task time", "Short Description / Notes"]) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    await scan(page, info, "calendar-navigation");
});
