"use client";

import { useEffect, useState } from "react";

import LeadTable from "@/components/leads/LeadTable";
import ReadError from "@/components/ui/read-error";
import { Lead } from "@/domain/objects/Lead";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";

export default function LeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [readError, setReadError] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

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

        loadLeads();

        return () => {
            active = false;
        };
    }, [refreshKey]);

    function retry() {
        setLoading(true);
        setRefreshKey((key) => key + 1);
    }

    return (
        <div>
            {readError ? (
                <ReadError resource="leads" onRetry={retry} pending={loading} />
            ) : loading ? (
                <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
                    Loading leads...
                </div>
            ) : (
                <LeadTable leads={leads} />
            )}
        </div>
    );
}
