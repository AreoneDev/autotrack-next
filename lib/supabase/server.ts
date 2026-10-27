import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function requireServerClient() {
    const cookieStore = await cookies();
    const client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                // Proxy refreshes cookies before Server Components run.
                setAll: () => {},
            },
        }
    );
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims) redirect("/login");
    return client;
}
