import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    // Accept only the recovery destination, never an arbitrary redirect URL.
    const recovery = params.get("next") === "/reset-password";
    const failurePath = recovery ? "/forgot-password?error=callback" : "/login?error=callback";
    // Relative Location keeps the browser's original host and its session cookies.
    // NextURL normalizes loopback hosts, so reconstructing an origin can lose them.
    const response = new NextResponse(null, {
        status: 307,
        headers: { Location: recovery ? "/reset-password" : "/dashboard" },
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    const fail = () => {
        // Preserve cookie removals/changes made during a failed code exchange.
        response.headers.set("Location", failurePath);
        return response;
    };
    const code = params.get("code");
    if (!code || params.has("error") || params.has("error_code")) return fail();
    try {
        const client = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            {
                cookies: {
                    getAll: () => request.cookies.getAll(),
                    setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
                },
            }
        );
        const flowId = params.get("sb_flow_id");
        const { error } = flowId
            ? await client.auth.exchangeCodeForSession(code, { flowId })
            : await client.auth.exchangeCodeForSession(code);
        if (error) return fail();
        return response;
    } catch {
        return fail();
    }
}
