"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import LeadTable from "@/components/leads/LeadTable";
import ReadError from "@/components/ui/read-error";
import { Lead } from "@/domain/objects/Lead";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";
import { readAllPages } from "@/lib/persistence/real/supabase/readAllPages";
import { supabase } from "@/lib/supabase/client";
import { getMessageReplyState, type MessageReplyRecord } from "@/domain/business/MessageReplyService";
import { localDateInput } from "@/lib/date";

type FollowUpRow = { task_id: number; lead_id: number | null; task_date: string | null; task_type: string | null; completed: boolean | null };

export default function LeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [readError, setReadError] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [followUpLeadIds, setFollowUpLeadIds] = useState<number[] | null>(null);
    const [unrepliedLeadIds, setUnrepliedLeadIds] = useState<number[] | null>(null);
    const [workFiltersRefresh, setWorkFiltersRefresh] = useState(0);

    useEffect(() => {
        let active = true;
        async function loadWorkFilters() {
            const [tasks, messages] = await Promise.allSettled([
                readAllPages<FollowUpRow>((from, to) => supabase.from("tasks").select("task_id,lead_id,task_date,task_type,completed").order("task_id", { ascending: true }).range(from, to)),
                readAllPages<MessageReplyRecord>((from, to) => supabase.from("notifications").select("notification_id,lead_id,title,date,contact_direction,replied_at").order("notification_id", { ascending: true }).range(from, to)),
            ]);
            if (!active) return;
            const today = localDateInput();
            setFollowUpLeadIds(tasks.status === "fulfilled" ? [...new Set(tasks.value.filter((task) => task.lead_id != null && task.completed !== true && task.task_type?.trim().toLowerCase() === "follow-up" && !!task.task_date && task.task_date.slice(0, 10) <= today).map((task) => task.lead_id as number))] : null);
            const now = new Date();
            setUnrepliedLeadIds(messages.status === "fulfilled" ? [...new Set(messages.value.filter((record) => getMessageReplyState(record, now) === "pending_reply").map((record) => record.lead_id as number))] : null);
        }
        void loadWorkFilters();
        return () => { active = false; };
    }, [workFiltersRefresh]);

    useEffect(() => {
        let active = true;
        async function loadLeads() {
            try {
                const leadRepository = new LeadRepo();
                const leadsFromRepository = await leadRepository.getAllLeads();
                const nextLeads = await hydrateLeadTableData(leadsFromRepository);
                if (active) {
                    setLeads(nextLeads);
                    setReadError(false);
                }
            } catch {
                if (active) setReadError(true);
            } finally {
                if (active) setLoading(false);
            }
        }
        void loadLeads();
        return () => { active = false; };
    }, [refreshKey]);

    function retry() {
        setLoading(true);
        setRefreshKey((key) => key + 1);
    }

    return (
        <div>
            <div className="mb-4 flex justify-end">
                <details className="relative" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); } }}>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-blue-50">More <span aria-hidden="true" className="ml-2">⋯</span></summary>
                    <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <Link href="/data#export-title" className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-blue-50">Export data…</Link>
                        <Link href="/data#recovery-title" className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-blue-50">Restore deleted customers…</Link>
                    </div>
                </details>
            </div>
            {readError ? (
                <ReadError resource="leads" onRetry={retry} pending={loading} />
            ) : loading ? (
                <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">Loading leads...</div>
            ) : (
                <LeadTable leads={leads} followUpLeadIds={followUpLeadIds} unrepliedLeadIds={unrepliedLeadIds} onRetryWorkFilters={() => setWorkFiltersRefresh((value) => value + 1)} />
            )}
        </div>
    );
}
