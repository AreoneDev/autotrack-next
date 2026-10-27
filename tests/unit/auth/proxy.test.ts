/** @jest-environment node */
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { proxy } from "@/proxy";

jest.mock("@supabase/ssr", () => ({ createServerClient: jest.fn() }));

describe("protected page requests", () => {
    const claims = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(createServerClient).mockReturnValue({ auth: { getClaims: claims } } as unknown as ReturnType<typeof createServerClient>);
    });
    it("redirects an anonymous server-rendered page before data loading", async () => {
        claims.mockResolvedValue({ data: null, error: null });
        const response = await proxy(new NextRequest("http://localhost:3000/leads/1"));
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("http://localhost:3000/login");
        expect(response.headers.get("cache-control")).toContain("no-store");
    });
    it("does not redirect login or the email callback", async () => {
        claims.mockResolvedValue({ data: null, error: null });
        for (const path of ["/login", "/auth/callback?code=example"]) {
            expect((await proxy(new NextRequest(`http://localhost:3000${path}`))).status).toBe(200);
        }
    });
    it("allows a verified identity without caching personalized output", async () => {
        claims.mockResolvedValue({ data: { claims: { sub: "test-user" } }, error: null });
        const response = await proxy(new NextRequest("http://localhost:3000/analytics"));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
    it("blocks former mutation test routes without initializing a database client", async () => {
        const response = await proxy(new NextRequest("http://localhost:3000/test-lead-repo"));
        expect(response.status).toBe(404);
        expect(createServerClient).not.toHaveBeenCalled();
    });
});
