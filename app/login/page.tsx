"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase/client";

type AuthMode = "password" | "code" | "register";

export default function LoginPage() {
    const router = useRouter();
    const [mode, setMode] = useState<AuthMode>("password");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        let isMounted = true;

        async function redirectSignedInUser() {
            const { data } = await supabase.auth.getSession();

            if (isMounted && data.session) {
                router.replace("/dashboard");
            }
        }

        void redirectSignedInUser();

        return () => {
            isMounted = false;
        };
    }, [router]);

    function selectMode(nextMode: AuthMode) {
        setMode(nextMode);
        setMessage("");
        setError("");
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setMessage("");
        setIsSubmitting(true);

        try {
            if (mode === "code") {
                const { error: otpError } = await supabase.auth.signInWithOtp({
                    email,
                    options: {
                        emailRedirectTo: `${window.location.origin}/login`,
                    },
                });

                if (otpError) {
                    setError(otpError.message);
                } else {
                    setMessage("A sign-in link has been sent to your email address.");
                }

                return;
            }

            if (mode === "register") {
                const { data, error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/login`,
                    },
                });

                if (signUpError) {
                    setError(signUpError.message);
                } else if (data.session) {
                    router.replace("/dashboard");
                } else {
                    setMessage("Check your email to confirm your new account.");
                }

                return;
            }

            const { error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInError) {
                setError(signInError.message);
            } else {
                router.replace("/dashboard");
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    const requiresPassword = mode !== "code";

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
            <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <p className="text-sm font-semibold text-blue-700">AutoTrack</p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900">
                    {mode === "register" ? "Create your account" : "Sign in"}
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                    Your customer data is available only to your AutoTrack account.
                </p>

                <div className="mt-6 grid grid-cols-3 gap-2 text-sm">
                    <button className={`rounded-lg px-3 py-2 ${mode === "password" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => selectMode("password")} type="button">Password</button>
                    <button className={`rounded-lg px-3 py-2 ${mode === "code" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => selectMode("code")} type="button">Email link</button>
                    <button className={`rounded-lg px-3 py-2 ${mode === "register" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => selectMode("register")} type="button">Register</button>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <label className="block text-sm font-medium text-slate-700">
                        Email
                        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
                    </label>
                    {requiresPassword ? (
                        <label className="block text-sm font-medium text-slate-700">
                            Password
                            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
                        </label>
                    ) : null}

                    {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                    {message ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

                    <button className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={isSubmitting} type="submit">
                        {isSubmitting ? "Please wait…" : mode === "code" ? "Send sign-in link" : mode === "register" ? "Create account" : "Sign in"}
                    </button>
                </form>
            </section>
        </main>
    );
}
