"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
type Account = { user: User | null; name: string; initials: string; busy: boolean; operation: "save" | "signout" | null; error: string; signOut: () => Promise<void>; saveName: (name: string) => Promise<boolean>; setDirty: (value: boolean) => void; confirmLeave: () => boolean };
const Context = createContext<Account | null>(null);
export function AccountProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState<"save" | "signout" | null>(null);
    const [error, setError] = useState("");
    const dirty = useRef(false), busyRef = useRef(false), userId = useRef<string | null>(null);
    const router = useRouter();
    const confirmLeave = useCallback(() => !dirty.current || window.confirm("Discard unsaved changes?"), []);
    const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
    useEffect(() => {
        let active = true, changed = false;
        const update = (next: User | null) => { userId.current = next?.id ?? null; setUser(next); };
        void supabase.auth.getSession().then(({ data, error }) => { if (error) throw error; if (active && !changed) update(data.session?.user ?? null); }).catch(() => { if (active && !changed) setError("Unable to load account. Please reload to try again."); });
        const { data } = supabase.auth.onAuthStateChange((_event, session) => { changed = true; if (active) update(session?.user ?? null); });
        return () => { active = false; data.subscription.unsubscribe(); };
    }, []);
    useEffect(() => {
        let restoringHistory = false;
        const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
        const popstate = (event: PopStateEvent) => {
            if (restoringHistory) { restoringHistory = false; event.stopImmediatePropagation(); return; }
            if (!dirty.current && !busyRef.current) return;
            if (busyRef.current || !confirmLeave()) { event.stopImmediatePropagation(); restoringHistory = true; window.history.forward(); }
            else dirty.current = false;
        };
        const click = (event: MouseEvent) => {
            const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
            if (!link || link.origin !== location.origin || link.target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.href === location.href) return;
            if (busyRef.current || !confirmLeave()) { event.preventDefault(); event.stopPropagation(); } else dirty.current = false;
        };
        window.addEventListener("beforeunload", beforeUnload); window.addEventListener("popstate", popstate, true); document.addEventListener("click", click, true);
        return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("popstate", popstate, true); document.removeEventListener("click", click, true); };
    }, [confirmLeave]);
    async function signOut() {
        if (busyRef.current || !confirmLeave()) return;
        busyRef.current = true; setBusy(true); setOperation("signout"); setError("");
        try { const { error } = await supabase.auth.signOut({ scope: "local" }); if (error) throw error; dirty.current = false; router.replace("/login"); }
        catch { setError("Sign out failed. Please try again."); }
        finally { busyRef.current = false; setBusy(false); setOperation(null); }
    }
    async function saveName(name: string) {
        if (busyRef.current || !userId.current) return false;
        const id = userId.current; busyRef.current = true; setBusy(true); setOperation("save"); setError("");
        try { const { data, error } = await supabase.auth.updateUser({ data: { display_name: name } }); if (error || !data.user) throw error; if (userId.current !== id) return false; setUser(data.user); dirty.current = false; return true; }
        catch { setError("Couldn’t save your name. Please try again."); return false; }
        finally { busyRef.current = false; setBusy(false); setOperation(null); }
    }
    const name = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
    const initials = name ? name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase() : (user?.email?.[0]?.toUpperCase() ?? "");
    return <Context.Provider value={{ user, name, initials, busy, operation, error, signOut, saveName, setDirty, confirmLeave }}>{children}</Context.Provider>;
}
export function useAccount() { const value = useContext(Context); if (!value) throw new Error("AccountProvider is missing"); return value; }
