"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerDataRepo, type RecoveryEntry } from "@/lib/data/CustomerDataRepo";
import { exportToCsv } from "@/lib/data/csv";
import { supabase } from "@/lib/supabase/client";

export default function CustomerDataPage() {
    const [entries, setEntries] = useState<RecoveryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [busy, setBusy] = useState(false);
    const [selection, setSelection] = useState<RecoveryEntry | null>(null);
    const [restoredId, setRestoredId] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    // Invalidates in-flight account-scoped results on sign-out/account changes.
    const generation = useRef(0);
    const acting = useRef(false);

    async function load() {
        const current = ++generation.current;
        setLoading(true);
        setLoadError("");
        try {
            const result = await new CustomerDataRepo().listDeleted();
            if (current === generation.current) setEntries(result);
        } catch {
            if (current === generation.current) {
                setEntries([]);
                setLoadError("Unable to load deleted customers. Please retry in a moment.");
            }
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }

    useEffect(() => {
        let active = true;
        const invalidate = () => { generation.current += 1; };
        const timer = window.setTimeout(() => { if (active) void load(); }, 0);
        const { data } = supabase.auth.onAuthStateChange(() => {
            if (!active) return;
            invalidate();
            setEntries([]);
            setSelection(null);
            setRestoredId(null);
            setMessage("");
            setActionError("");
            // Leave the callback synchronous; Supabase auth callbacks may hold a lock.
            queueMicrotask(() => { if (active) void load(); });
        });
        return () => { active = false; invalidate(); window.clearTimeout(timer); data.subscription.unsubscribe(); };
    }, []);

    async function restore() {
        if (!selection || acting.current) return;
        const chosen = selection;
        const current = generation.current;
        acting.current = true;
        setBusy(true);
        setActionError("");
        try {
            const id = await new CustomerDataRepo().restore(chosen.recovery_id);
            if (current !== generation.current) return;
            setRestoredId(id);
            setEntries(previous => previous.filter(row => row.recovery_id !== chosen.recovery_id));
            setSelection(null);
            setMessage("Customer and related records restored.");
        } catch (error) {
            if (current === generation.current) setActionError(error instanceof Error ? error.message : "Restore failed. Please retry.");
        } finally { acting.current = false; setBusy(false); }
    }

    async function download() {
        if (acting.current) return;
        const current = generation.current;
        acting.current = true;
        setBusy(true);
        setActionError("");
        try {
            const data = await new CustomerDataRepo().exportData();
            const csv = exportToCsv(data);
            if (current !== generation.current) return;
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `autotrack-data-${data.exported_at.slice(0, 10).replace(/[^0-9-]/g, "")}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage("CSV export downloaded.");
        } catch (error) {
            if (current === generation.current) setActionError(error instanceof Error ? error.message : "Export failed. No file was downloaded.");
        } finally { acting.current = false; setBusy(false); }
    }

    return <div className="space-y-6">
        <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-blue-700">← Settings</Link>
        <h2 className="text-2xl font-semibold">Manage customer data</h2>
        <section aria-labelledby="export-title" className="space-y-3 rounded-lg border bg-white p-5">
            <h2 id="export-title" className="text-lg font-medium">Export CSV</h2>
            <p>Download all your customers, tasks, notifications, vehicle links, recovery snapshots and deletion history. Each row identifies its record type and preserves related IDs.</p>
            <p className="text-sm text-slate-600">Includes all customers, regardless of list filters. The file contains personal customer data. Keep it in a private location. CSV files are for viewing and archival; they cannot be imported to restore customers.</p>
            <Button disabled={busy} onClick={() => { void download(); }}>Download CSV</Button>
        </section>
        {message && <p role="status">{message} {restoredId && <Link className="text-blue-700 underline" href={`/leads/${restoredId}`}>View restored customer</Link>}</p>}
        {actionError && <p role="alert" className="text-red-700">{actionError}</p>}
        <section aria-labelledby="recovery-title" className="space-y-3 rounded-lg border bg-white p-5">
            <h2 id="recovery-title" className="text-lg font-medium">Deleted customers</h2>
            <p>Restore a customer with their tasks, notifications and vehicle links, including completed history. Existing vehicle records are linked without changing their current details.</p>
            <p className="text-sm text-slate-600">Only deletions made through the transactional delete flow after recovery was enabled are recoverable. Older deletions require an administrator backup. Snapshots are kept until an administrator changes retention.</p>
            <Button variant="outline" disabled={loading || busy} onClick={() => { setSelection(null); void load(); }}>Refresh deleted customers</Button>
            {loading ? <p role="status">Loading deleted customers…</p> : loadError ? <p role="alert" className="text-red-700">{loadError}</p> : entries.length === 0 ? <p>No deleted customers to restore.</p> : <ul className="divide-y">
                {entries.map(entry => <li key={entry.recovery_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><p className="font-medium">{[entry.snapshot.lead.first_name, entry.snapshot.lead.last_name].filter(Boolean).join(" ") || `Customer #${entry.lead_id}`}</p>
                        <p className="text-sm text-slate-600">Deleted {new Date(entry.deleted_at).toLocaleString()} · {entry.snapshot.tasks.length} tasks · {entry.snapshot.notifications.length} notifications</p></div>
                    <Button variant="outline" disabled={busy} onClick={() => { setSelection(entry); setActionError(""); }}>Restore customer #{entry.lead_id}</Button>
                </li>)}
            </ul>}
            {selection && <div role="group" aria-label="Confirm customer restoration" className="space-y-3 rounded border border-blue-200 bg-blue-50 p-4">
                <p>Restore customer #{selection.lead_id} and all their related records? An ID conflict or missing vehicle will stop the entire restore.</p>
                <div className="flex gap-3"><Button disabled={busy} onClick={() => { void restore(); }}>{busy ? "Restoring…" : "Confirm restore"}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setSelection(null)}>Cancel</Button></div>
            </div>}
        </section>
    </div>;
}
