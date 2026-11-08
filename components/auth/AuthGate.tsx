"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { supabase } from "@/lib/supabase/client";
import { AccountProvider } from "@/components/auth/AccountProvider";
import { isPublicAuthPage } from "@/lib/auth/routes";

type AuthGateProps = {
    children: ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
    const pathname = usePathname();
    const router = useRouter();
    const isPublic = isPublicAuthPage(pathname);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [sessionError, setSessionError] = useState("");
    const drawer = useRef<HTMLDialogElement>(null);

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

        if (!isPublic) {
            void verifySession();
        }

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!isMounted) return;
            setIsCheckingSession(!session);
            if (!session && !isPublic) router.replace("/login");
        });

        return () => {
            isMounted = false;
            listener.subscription.unsubscribe();
        };
    }, [isPublic, router]);

    if (isPublic) {
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
        <AccountProvider><div className="flex h-screen overflow-hidden">
            <a tabIndex={0} href="#main-content" className="skip-link">Skip to main content</a>
            <div className="hidden md:block"><Sidebar /></div>
            <dialog ref={drawer} aria-label="Navigation" onClick={event => { if (event.target === event.currentTarget) drawer.current?.close(); }} className="m-0 h-full max-h-none w-[min(18rem,calc(100vw-3rem))] max-w-none overflow-y-auto bg-white p-0 backdrop:bg-slate-900/50 md:hidden">
                <button type="button" onClick={() => drawer.current?.close()} className="absolute right-3 top-3 rounded-lg p-2 text-slate-600" aria-label="Close navigation">✕</button>
                <Sidebar mobile onNavigate={() => drawer.current?.close()} />
            </dialog>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <TopBar onOpenNavigation={() => drawer.current?.showModal()} />
                <main id="main-content" tabIndex={0} aria-labelledby="page-title" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
                    {children}
                </main>
            </div>
        </div></AccountProvider>
    );
}
