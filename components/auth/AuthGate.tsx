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

    useEffect(() => {
        let isMounted = true;

        async function verifySession() {
            const { data } = await supabase.auth.getSession();

            if (!isMounted) {
                return;
            }

            if (!data.session) {
                router.replace("/login");
                return;
            }

            setIsCheckingSession(false);
        }

        if (pathname !== "/login") {
            void verifySession();
        }

        return () => {
            isMounted = false;
        };
    }, [pathname, router]);

    if (pathname === "/login") {
        return <>{children}</>;
    }

    if (isCheckingSession) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <p className="text-sm text-slate-600">Checking your session…</p>
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
