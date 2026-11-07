import { backendURL } from "./fixtures/endpoints";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
    const response = await request.post(`${backendURL}/__test__/reset`);
    expect(response.ok()).toBe(true);
});

for (const path of ["/dashboard", "/leads", "/leads/123", "/agenda", "/analytics"]) {
    test(`E2E-AUTH-01: anonymous ${path} redirects before showing customer data`, async ({ page }) => {
        await page.goto(`${path}?private=synthetic`);
        await expect(page).toHaveURL("/login");
        await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
        await expect(page.getByText("Checking your session…")).toHaveCount(0);
    });
}

test("E2E-AUTH-02: login, authenticated navigation, and logout", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    const accountEmail = page.getByText("ada@example.test", { exact: true });
    if ((page.viewportSize()?.width ?? 0) >= 640) {
        await expect(accountEmail).toBeVisible();
    } else {
        await expect(accountEmail).toBeHidden();
    }
    await page.goto("/leads");
    await expect(page.getByRole("heading", { name: "Lead Filters" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/leads");
    await expect(page).toHaveURL("/login");
});

test("E2E-AUTH-03: invalid credentials show an error and permit retry", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Invalid login credentials", { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

for (const length of [7, 8, 9]) {
    test(`E2E-AUTH-04: registration password boundary ${length}`, async ({ page }) => {
        await page.goto("/login");
        await page.getByRole("button", { name: "Register", exact: true }).click();
        await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
        await page.getByLabel("Password", { exact: true }).fill("x".repeat(length));
        let submissions = 0;
        page.on("request", (request) => { if (request.url().includes("/auth/v1/signup")) submissions++; });
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        if (length < 8) {
            expect(await page.getByLabel("Password", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
            expect(submissions).toBe(0);
        } else {
            await expect(page.getByText("Check your email to confirm your new account.")).toBeVisible();
            expect(submissions).toBe(1);
        }
    });
}

test("E2E-AUTH-05: email link mode sends a confirmation and hides password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Email link" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("A sign-in link has been sent to your email address.")).toBeVisible();
});

test("E2E-AUTH-06: former mutation pages return 404", async ({ request }) => {
    const response = await request.get("/test-lead-repo");
    expect(response.status()).toBe(404);
});
