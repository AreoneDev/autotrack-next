import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { backendURL } from "./fixtures/endpoints";

test.beforeEach(async ({ request }) => {
    expect((await request.post(`${backendURL}/__test__/reset`)).ok()).toBe(true);
});

test("forgot password completes a PKCE callback and changes the synthetic password", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
    await expect(page.getByRole("button", { name: /Try again in/ })).toBeDisabled();
    const link = await (await request.get(`${backendURL}/__test__/recovery-link`)).json();
    await page.goto(link.url);
    await expect(page).toHaveURL("/reset-password");
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("new-password-456");
    await page.getByLabel("Confirm new password").fill("new-password-457");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Passwords do not match.");
    await page.getByLabel("Confirm new password").fill("new-password-456");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("status")).toHaveText("Your password has been updated.");
    await page.getByRole("link", { name: "Continue to AutoTrack" }).click();
    await expect(page).toHaveURL("/dashboard");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("new-password-456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    await page.goto(link.url);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeEnabled();
});

test("invalid callback and fragment errors keep confirmation resend available", async ({ page, request }) => {
    await page.goto("/auth/callback?error=access_denied&error_code=otp_expired&error_description=untrusted");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
    await page.getByRole("link", { name: "Resend confirmation email" }).click();
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByRole("button", { name: "Resend confirmation email" }).click();
    await expect(page.getByRole("status")).toContainText("If this email has an account awaiting confirmation");
    await expect(page.getByRole("button", { name: /Try again in/ })).toBeDisabled();
    const confirmation = await (await request.get(`${backendURL}/__test__/recovery-link`)).json();
    await page.goto(confirmation.url);
    await expect(page).toHaveURL("/dashboard");
    await page.goto("/login#error=access_denied&error_code=otp_expired");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
    await expect(page).toHaveURL("/login");
});

test("a link opened in a different browser cannot bypass PKCE", async ({ page, browser, request }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    const link = await (await request.get(`${backendURL}/__test__/recovery-link`)).json();
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    try {
        await otherPage.goto(link.url);
        await expect(otherPage.getByRole("main").getByRole("alert")).toContainText("same browser");
        await expect(otherPage.getByLabel("New password", { exact: true })).toHaveCount(0);
    } finally {
        await otherContext.close();
    }
});

test("anonymous reset page offers recovery without a password form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("expired");
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Request a new reset link" }).click();
    await expect(page).toHaveURL("/forgot-password");
});

test("recovery pages are accessible and fit the viewport", async ({ page }) => {
    for (const path of ["/forgot-password", "/resend-confirmation", "/reset-password"]) {
        await page.goto(path);
        await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
        if (path === "/reset-password") await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
});
