import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { GET } from "@/app/auth/callback/route";

jest.mock("@supabase/ssr", () => ({ createServerClient: jest.fn() }));

describe("AUTH-CB — callback route and response integration", () => {
    const exchange = jest.fn();
    beforeEach(() => {
        exchange.mockReset().mockResolvedValue({ error: null });
        jest.mocked(createServerClient).mockReturnValue({ auth: { exchangeCodeForSession: exchange } } as unknown as ReturnType<typeof createServerClient>);
    });

    it("AUTH-CB-01: successful code exchange redirects with session cookies and no caching", async () => {
        exchange.mockImplementation(async () => {
            const options = jest.mocked(createServerClient).mock.calls[0][2];
            await options.cookies?.setAll?.([{ name: "sb-session", value: "synthetic", options: { httpOnly: true, path: "/" } }], {});
            return { error: null };
        });
        const request = new NextRequest("http://localhost/auth/callback?code=one-time&next=https://untrusted.example");
        const response = await GET(request);
        expect(exchange).toHaveBeenCalledWith("one-time");
        expect(response.headers.get("location")).toBe("/dashboard");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.cookies.get("sb-session")?.value).toBe("synthetic");
    });

    it("recovery codes route to the password form and forward the PKCE flow id", async () => {
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=reset&next=/reset-password&sb_flow_id=flow-example"));
        expect(exchange).toHaveBeenCalledWith("reset", { flowId: "flow-example" });
        expect(response.headers.get("location")).toBe("/reset-password");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    });
    it.each(["", "&error=access_denied", "&error_code=otp_expired"])("expired recovery callbacks offer a new link: %s", async suffix => {
        exchange.mockResolvedValue({ error: { code: "otp_expired" } });
        const response = await GET(new NextRequest("http://localhost/auth/callback?next=/reset-password&code=expired" + suffix));
        expect(response.headers.get("location")).toBe("/forgot-password?error=callback");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
    it("missing recovery code never initializes Supabase", async () => {
        const response = await GET(new NextRequest("http://localhost/auth/callback?next=/reset-password"));
        expect(createServerClient).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe("/forgot-password?error=callback");
    });
    it("retains cookie cleanup on a failed exchange", async () => {
        exchange.mockImplementation(async () => {
            const options = jest.mocked(createServerClient).mock.calls[0][2];
            await options.cookies?.setAll?.([{ name: "sb-verifier", value: "", options: { maxAge: 0, path: "/" } }], {});
            return { error: { code: "otp_expired" } };
        });
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=expired"));
        expect(response.cookies.get("sb-verifier")?.value).toBe("");
        expect(response.headers.get("location")).toBe("/login?error=callback");
    });
    it("transport exceptions return a recoverable page", async () => {
        exchange.mockRejectedValue(new Error("offline"));
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=reset&next=/reset-password"));
        expect(response.headers.get("location")).toBe("/forgot-password?error=callback");
    });
    it.each(["https://untrusted.example", "//untrusted.example", "/reset-password?next=https://untrusted.example"])("rejects an unrecognized next destination: %s", async next => {
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=valid&next=" + encodeURIComponent(next)));
        expect(response.headers.get("location")).toBe("/dashboard");
    });

    it("keeps redirects on the browser origin regardless of normalized URL or forwarded host", async () => {
        const response = await GET(new NextRequest("http://localhost:3183/auth/callback?code=valid&next=/reset-password", {
            headers: { host: "127.0.0.1:3183", "x-forwarded-host": "untrusted.example" },
        }));
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("/reset-password");
    });

    it("AUTH-CB-02: absent code does not attempt an exchange", async () => {
        const response = await GET(new NextRequest("http://localhost/auth/callback"));
        expect(exchange).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe("/login?error=callback");
    });

    it("AUTH-CB-03: rejected or expired code cannot reach the dashboard", async () => {
        exchange.mockResolvedValue({ error: { message: "Code expired" } });
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=expired"));
        expect(response.headers.get("location")).toBe("/login?error=callback");
        expect(response.cookies.get("sb-session")).toBeUndefined();
    });
});
