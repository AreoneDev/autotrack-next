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
        expect(response.headers.get("location")).toBe("http://localhost/dashboard");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.cookies.get("sb-session")?.value).toBe("synthetic");
    });

    it("AUTH-CB-02: absent code does not attempt an exchange", async () => {
        const response = await GET(new NextRequest("http://localhost/auth/callback"));
        expect(exchange).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe("http://localhost/login?error=callback");
    });

    it("AUTH-CB-03: rejected or expired code cannot reach the dashboard", async () => {
        exchange.mockResolvedValue({ error: { message: "Code expired" } });
        const response = await GET(new NextRequest("http://localhost/auth/callback?code=expired"));
        expect(response.headers.get("location")).toBe("http://localhost/login?error=callback");
        expect(response.cookies.get("sb-session")).toBeUndefined();
    });
});
