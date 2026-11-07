"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AccountMenu() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        void supabase.auth.getSession().then(({ data }) => {
            if (active) setEmail(data.session?.user.email ?? "");
        });
        const { data } = supabase.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email ?? ""));
        return () => { active = false; data.subscription.unsubscribe(); };
    }, []);
    async function signOut() {
        setBusy(true);
        setError("");
        try {
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) throw error;
            router.replace("/login");
        } catch {
            setError("Sign out failed. Please try again.");
        } finally { setBusy(false); }
    }
    return <div className="min-w-0 text-sm">
        <p className="hidden max-w-48 truncate text-slate-700 sm:block" title={email}>{email || "AutoTrack account"}</p>
        <Button variant="ghost" type="button" onClick={signOut} disabled={busy} className="text-blue-700 disabled:opacity-50 sm:mt-1">{busy ? "Signing out…" : "Sign out"}</Button>
        {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>;
}
