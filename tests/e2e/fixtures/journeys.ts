import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { backendURL } from "./endpoints";

export function day(offset = 0): string {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

export function lead(overrides = {}) {
    return {
        lead_id: 1, first_name: "Journey", last_name: "Customer", phone: "4165550100",
        lead_email: "journey@example.test", stage: "CONTACTED", status: true,
        budget: 35000, notes: "Original notes", created_at: `${day()}T12:00:00Z`,
        follow_up_date: `${day(7)}T12:00:00Z`, last_interaction_date: `${day()}T12:00:00Z`,
        last_interaction_by: "Customer", ...overrides,
    };
}

export function task(id: number, title: string, offset = 0, completed = false) {
    return {
        task_id: id, lead_id: 1, title, task_type: "Follow-up",
        task_date: `${day(offset)}T09:30:00`, completed, notes: `Notes for ${title}`,
    };
}

export async function reset(request: APIRequestContext, tables = {}) {
    expect((await request.post(`${backendURL}/__test__/reset`, { data: tables })).ok()).toBe(true);
}

export async function failNext(request: APIRequestContext, table: string, method: string) {
    expect((await request.post(`${backendURL}/__test__/fail-next`, {
        data: { table, method },
    })).ok()).toBe(true);
}

export async function state(request: APIRequestContext) {
    const response = await request.get(`${backendURL}/__test__/state`);
    expect(response.ok()).toBe(true);
    return response.json();
}

export async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
}

export async function refreshed(page: Page, action: () => Promise<unknown>) {
    const pathname = new URL(page.url()).pathname;
    const [response] = await Promise.all([
        page.waitForResponse((response) =>
            new URL(response.url()).pathname === pathname &&
            response.request().method() === "GET" &&
            (response.headers()["content-type"] ?? "").includes("text/x-component")
        ),
        action(),
    ]);
    expect(response.ok()).toBe(true);
}
