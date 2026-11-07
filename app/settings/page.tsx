"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { AccountAvatar, SignOutButton } from "@/components/auth/AccountMenu";
import { useAccount } from "@/components/auth/AccountProvider";

function Profile({ initialName }: { initialName: string }) {
    const { name, busy, operation, error, saveName, setDirty } = useAccount();
    const [draft, setDraft] = useState(initialName);
    const [validation, setValidation] = useState("");
    const [saved, setSaved] = useState(false);
    const changed = draft !== name;
    useEffect(() => () => setDirty(false), [setDirty]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = draft.trim();
        if (!value || value.length > 60) { setValidation("Enter a display name between 1 and 60 characters."); return; }
        setValidation(""); setSaved(false);
        if (await saveName(value)) { setDraft(value); setSaved(true); }
    }
    return <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-6"><h2 className="text-lg font-semibold">Profile</h2><p className="mt-1 text-sm text-slate-500">Your name as it appears in AutoTrack.</p></div>
        <form onSubmit={submit} className="p-6"><div className="mb-5 flex items-center gap-3"><AccountAvatar /><div><p className="font-semibold">{name || "AutoTrack account"}</p><p className="text-sm text-slate-500">Initials from your display name</p></div></div>
            <label htmlFor="display-name" className="block text-sm font-medium">Display name</label>
            <input id="display-name" value={draft} onChange={event => { setDraft(event.target.value); setDirty(event.target.value !== name); setSaved(false); setValidation(""); }} disabled={busy} maxLength={80} aria-describedby="display-name-help" aria-invalid={!!validation} className="mt-2 block w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2" />
            <p id="display-name-help" className="mt-1 text-sm text-slate-500">1–60 characters. Visible only in your account.</p>
            {validation && <p role="alert" className="mt-2 text-sm text-red-700">{validation}</p>}
            {error.startsWith("Couldn’t") && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3"><button type="submit" disabled={!changed || busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{operation === "save" ? "Saving…" : "Save changes"}</button><button type="button" disabled={!changed || busy} onClick={() => { setDraft(name); setDirty(false); setValidation(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-50">Cancel</button><span role="status" className="text-sm text-green-700">{saved ? "Saved" : ""}</span></div>
        </form>
    </section>;
}
export default function SettingsPage() {
    const { user, error } = useAccount();
    return <div className="max-w-3xl space-y-5"><Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-blue-700"><ArrowLeft size={16} />Back to Dashboard</Link>
        {user ? <Profile key={user.id} initialName={typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : ""} /> : <p role={error ? "alert" : "status"} className="text-sm text-slate-500">{error || "Loading account…"}</p>}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-6"><h2 className="text-lg font-semibold">Sign-in</h2><p className="mt-1 text-sm text-slate-500">The email address you use to access AutoTrack.</p></div><div className="p-6"><p className="text-sm text-slate-500">Email address</p><p className="mt-1 break-all">{user?.email || "—"}</p><p className="mt-2 text-sm text-slate-500">Use a password or an email link on the sign-in page.</p></div></section>
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div><h2 className="text-lg font-semibold">Current session</h2><p className="mt-1 text-sm text-slate-500">Sign out on this device.</p></div><SignOutButton /></section>
    </div>;
}
