import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get("code");
    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    response.headers.set("Cache-Control", "private, no-store");
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
    if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (!error) return response;
    }
    return NextResponse.redirect(new URL("/login?error=callback", request.url));
}
