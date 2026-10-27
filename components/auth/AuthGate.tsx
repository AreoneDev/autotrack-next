"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { supabase } from "@/lib/supabase/client";

type AuthGateProps = {
    children: ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [sessionError, setSessionError] = useState("");

    useEffect(() => {
        let isMounted = true;

        async function verifySession() {
            try {
            const { data, error } = await supabase.auth.getSession();

            if (!isMounted) {
                return;
            }

            if (error || !data.session) {
                setIsCheckingSession(true);
                router.replace("/login");
                return;
            }

            setIsCheckingSession(false);
            } catch {
                if (isMounted) setSessionError("Unable to check your session. Please reload to try again.");
            }
        }

        if (pathname !== "/login") {
            void verifySession();
        }

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!isMounted) return;
            setIsCheckingSession(!session);
            if (!session && pathname !== "/login") router.replace("/login");
        });

        return () => {
            isMounted = false;
            listener.subscription.unsubscribe();
        };
    }, [pathname, router]);

    if (pathname === "/login") {
        return <>{children}</>;
    }

    if (isCheckingSession) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <p role={sessionError ? "alert" : "status"} className="text-sm text-slate-600">{sessionError || "Checking your session…"}</p>
            </main>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <TopBar />
                <main className="min-h-0 flex-1 overflow-y-auto p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
