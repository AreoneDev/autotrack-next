import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { exportTables, type DataExport } from "./csv";
import { CustomerRecoveryUnavailableError } from "./CustomerRecoveryUnavailableError";

export type RecoveryEntry = {
    recovery_id: string;
    lead_id: string;
    deleted_at: string;
    snapshot: { lead: { first_name?: string | null; last_name?: string | null }; tasks: unknown[]; notifications: unknown[] };
};

export class CustomerDataRepo {
    constructor(private readonly client: SupabaseClient = supabase) {}

    async listDeleted(): Promise<RecoveryEntry[]> {
        // Page explicitly: PostgREST normally caps a table response at 1,000 rows.
        const rows: RecoveryEntry[] = [];
        const pageSize = 100;
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await this.client.from("lead_recovery_snapshots")
                .select("recovery_id,lead_id::text,deleted_at,snapshot")
                .is("restored_at", null).order("deleted_at", { ascending: false }).order("recovery_id")
                .range(offset, offset + pageSize - 1);
            if (error?.code === "PGRST205") throw new CustomerRecoveryUnavailableError(error);
            if (error || !Array.isArray(data) || data.some(row => !row || typeof row.recovery_id !== "string"
                || typeof row.lead_id !== "string" || !/^[1-9][0-9]*$/.test(row.lead_id)
                || !Number.isFinite(Date.parse(row.deleted_at)) || !row.snapshot?.lead
                || !Array.isArray(row.snapshot.tasks) || !Array.isArray(row.snapshot.notifications))) throw new Error("Unable to load deleted customers. Please try again.");
            rows.push(...data as RecoveryEntry[]);
            if (data.length < pageSize) return rows;
        }
    }

    async restore(recoveryId: string): Promise<string> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recoveryId)) {
            throw new Error("Invalid recovery selection. Reload and try again.");
        }
        const { data, error } = await this.client.rpc("autotrack_restore_lead", { p_recovery_id: recoveryId });
        if (error || typeof data !== "string" || !/^[1-9][0-9]*$/.test(data)) {
            throw new Error("Unable to restore this customer. No partial restore was saved. Retry or reload; an ID conflict or unavailable linked vehicle may need attention.");
        }
        return data;
    }

    async exportData(): Promise<DataExport> {
        const { data, error } = await this.client.rpc("autotrack_export_data");
        if (error || !data || data.format_version !== 1 || typeof data.exported_at !== "string"
            || exportTables.some(table => !Array.isArray(data[table])
                || data[table].some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row)))) {
            throw new Error("Export could not be completed. No file was downloaded. Please try again.");
        }
        return data as DataExport;
    }
}
