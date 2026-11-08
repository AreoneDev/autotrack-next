import type { ReactNode } from "react";
import Link from "next/link";

export default function RecoveryShell({ title, children }: { title: string; children: ReactNode }) {
    return (
        <main className="h-dvh overflow-y-auto bg-slate-50 p-6">
            <section className="mx-auto my-6 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:my-16 sm:p-8">
                <p className="text-sm font-semibold text-blue-700">AutoTrack</p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900">{title}</h1>
                {children}
                <Link href="/login" className="mt-6 inline-block text-sm font-medium text-blue-700 underline">Back to sign in</Link>
            </section>
        </main>
    );
}
