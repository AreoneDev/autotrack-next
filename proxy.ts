import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
    // Former development pages performed writes while rendering.
    if (request.nextUrl.pathname.startsWith("/test-")) {
        return new NextResponse("Not found", { status: 404 });
    }
    let response = NextResponse.next({ request });
    const client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                    response = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
                },
            },
        }
    );
    const { data, error } = await client.auth.getClaims();
    if ((error || !data?.claims) && request.nextUrl.pathname !== "/login" && !request.nextUrl.pathname.startsWith("/auth/")) {
        const destination = request.nextUrl.clone();
        destination.pathname = "/login";
        destination.search = "";
        const redirected = NextResponse.redirect(destination);
        response.cookies.getAll().forEach(cookie => redirected.cookies.set(cookie));
        redirected.headers.set("Cache-Control", "private, no-store");
        return redirected;
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
