"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RecoveryShell from "@/components/auth/RecoveryShell";
import { clearLinkError, expiredLinkMessage, readLinkError } from "@/lib/auth/recovery";
import { supabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
    const [state, setState] = useState<"checking" | "ready" | "invalid" | "failed" | "done">("checking");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submitting = useRef(false);

    useEffect(() => {
        let active = true;
        let sessionEnded = false;
        async function verifyUser() {
            try {
                // An existing cookie alone is not proof of an authenticated user.
                const { data, error } = await supabase.auth.getUser();
                if (!active) return;
                const url = new URL(window.location.href);
                const linkError = readLinkError(url);
                if (linkError) clearLinkError(url);
                setState(sessionEnded || linkError || error || !data.user ? "invalid" : "ready");
            } catch {
                if (active) setState("failed");
            }
        }
        void verifyUser();
        const { data: listener } = supabase.auth.onAuthStateChange((event) => {
            if (active && event === "SIGNED_OUT") {
                sessionEnded = true;
                setState(current => current === "done" ? current : "invalid");
                setPassword("");
                setConfirmation("");
            }
        });
        return () => {
            active = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current || state !== "ready") return;
        setError("");
        if (password.length < 8) {
            setError("Use at least 8 characters for your new password.");
            return;
        }
        if (password !== confirmation) {
            setError("Passwords do not match.");
            return;
        }
        submitting.current = true;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                if (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403 || ["session_not_found", "invalid_jwt", "refresh_token_not_found", "refresh_token_already_used"].includes(error.code ?? "")) {
                    setState("invalid");
                    setPassword("");
                    setConfirmation("");
                } else {
                    setError(error.code === "same_password" ? "Choose a password different from your current password."
                        : error.code === "weak_password" ? "This password does not meet the account security requirements. Choose a stronger password."
                        : "Unable to update your password. Please try again.");
                }
            } else {
                setPassword("");
                setConfirmation("");
                setState("done");
            }
        } catch {
            setError("Unable to reach the password service. Please try again.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <RecoveryShell title="Reset your password">
            {state === "checking" ? <p role="status" className="mt-4 text-sm text-slate-600">Verifying your reset session…</p> : null}
            {state === "invalid" || state === "failed" ? <>
                <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state === "invalid" ? expiredLinkMessage : "Unable to verify your reset session. Reload this page to try again, or request a new link."}</p>
                <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">Request a new reset link</Link>
            </> : null}
            {state === "done" ? <>
                <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Your password has been updated.</p>
                <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">Continue to AutoTrack</Link>
            </> : null}
            {state === "ready" ? <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <p className="text-sm text-slate-600">Choose a new password with at least 8 characters.</p>
                <label className="block text-sm font-medium text-slate-700">
                    New password
                    <Input className="mt-1" autoComplete="new-password" disabled={isSubmitting} minLength={8} onChange={event => setPassword(event.target.value)} required type="password" value={password} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                    Confirm new password
                    <Input className="mt-1" autoComplete="new-password" disabled={isSubmitting} minLength={8} onChange={event => setConfirmation(event.target.value)} required type="password" value={confirmation} />
                </label>
                {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                <Button className="w-full" disabled={isSubmitting} type="submit">{isSubmitting ? "Please wait…" : "Update password"}</Button>
            </form> : null}
        </RecoveryShell>
    );
}
