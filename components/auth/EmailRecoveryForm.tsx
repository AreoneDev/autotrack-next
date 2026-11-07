"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RecoveryShell from "@/components/auth/RecoveryShell";
import { clearLinkError, emailRequestError, expiredLinkMessage, readLinkError } from "@/lib/auth/recovery";
import { supabase } from "@/lib/supabase/client";

export default function EmailRecoveryForm({ kind }: { kind: "password" | "confirmation" }) {
    const [email, setEmail] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [linkError, setLinkError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const submitting = useRef(false);
    const isPassword = kind === "password";

    useEffect(() => {
        // Defer URL cleanup until the active effect runs (including Strict Mode replay).
        let active = true;
        void Promise.resolve().then(() => {
            if (!active) return;
            const url = new URL(window.location.href);
            if (readLinkError(url)) {
                setLinkError(true);
                clearLinkError(url);
            }
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!cooldown) return;
        const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [cooldown]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current || cooldown) return;
        submitting.current = true;
        setIsSubmitting(true);
        setError("");
        setMessage("");
        try {
            const address = email.trim();
            const callback = `${window.location.origin}/auth/callback`;
            const result = isPassword
                ? await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${callback}?next=/reset-password` })
                : await supabase.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: callback } });
            if (result.error) {
                setError(emailRequestError(result.error));
                if (result.error.status === 429 || result.error.code?.includes("rate_limit")) setCooldown(60);
            } else {
                setMessage(isPassword
                    ? "If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder. Open the newest link in this browser."
                    : "If this email has an account awaiting confirmation, you will receive a new confirmation link. Check your inbox and spam folder. Open the newest link in this browser.");
                setCooldown(60);
            }
        } catch {
            setError("Unable to reach the email service. Please try again.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <RecoveryShell title={isPassword ? "Forgot your password?" : "Resend confirmation email"}>
            <p className="mt-2 text-sm text-slate-600">{isPassword
                ? "Enter your account email to request a password reset link."
                : "Enter the email you used to register. You can request another confirmation if the original link expired or never arrived."}</p>
            {linkError ? <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{expiredLinkMessage}</p> : null}
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <label className="block text-sm font-medium text-slate-700">
                    Email
                    <Input className="mt-1" autoComplete="email" disabled={isSubmitting} onChange={event => setEmail(event.target.value)} required type="email" value={email} />
                </label>
                {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
                <Button className="w-full" disabled={isSubmitting || cooldown > 0} type="submit">
                    {isSubmitting ? "Please wait…" : cooldown ? `Try again in ${cooldown}s` : isPassword ? "Send reset link" : "Resend confirmation email"}
                </Button>
            </form>
            <p className="mt-4 text-sm"><Link href={isPassword ? "/resend-confirmation" : "/forgot-password"} className="text-blue-700 underline">
                {isPassword ? "Need to confirm your email?" : "Forgot your password?"}
            </Link></p>
        </RecoveryShell>
    );
}
