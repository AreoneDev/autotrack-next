"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { MessageReplyRepo, type MessageReplyResult } from "@/lib/persistence/real/supabase/MessageReplyRepo";
import { getMessageReplyState, summarizeMessageReplies } from "@/domain/business/MessageReplyService";

export default function MessageReplyPanel({ result, referenceTime }: {
    result: MessageReplyResult; referenceTime: string;
}) {
    const router = useRouter();
    const busy = useRef(false);
    const [saving, setSaving] = useState<number | null>(null);
    const [error, setError] = useState("");
    const now = new Date(referenceTime);
    const summary = summarizeMessageReplies(result.records, now);

    async function markReplied(id: number) {
        if (busy.current) return;
        busy.current = true;
        setSaving(id);
        setError("");
        const failure = await new MessageReplyRepo(supabase).markReplied(id);
        if (failure) setError(failure);
        else router.refresh();
        setSaving(null);
        busy.current = false;
    }

    return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6" aria-label="Reply status">
        <h2 className="text-lg font-semibold">Reply status</h2>
        {!result.available ? <p role="status">Reply tracking unavailable. Refresh to retry.</p> : <>
            <p className="mt-2 text-sm text-slate-600">
                Received: {summary.received} · Awaiting reply: {summary.pending} · Replied: {summary.replied}
            </p>
            <p className="mt-2 text-sm text-slate-500">Only recorded incoming contacts are tracked. Mark as replied after responding to that contact.</p>
            {summary.received === 0 && <p className="mt-3">No recorded incoming contacts.</p>}
            <ul className="mt-3 space-y-3">
                {result.records.filter(record => getMessageReplyState(record, now) !== "unknown").map(record => {
                    const state = getMessageReplyState(record, now);
                    return <li key={record.notification_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <div><p>{record.title || "Incoming contact"}</p><p className="text-sm text-slate-500">{record.date} · {state === "replied" ? "Replied" : "Awaiting reply"}</p></div>
                        {state === "pending_reply" && <button type="button" disabled={saving !== null}
                            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                            onClick={() => markReplied(record.notification_id)}>
                            {saving === record.notification_id ? "Saving…" : "Mark as replied"}
                        </button>}
                    </li>;
                })}
            </ul>
        </>}
        {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    </section>;
}

