import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { Lead } from "@/domain/objects/Lead";
import { ScoringService } from "@/domain/business/ScoringService";
import { contactChannels, contactDirections, contactOutcomes, validateContactRecord, type ContactDetails, type ContactRecord, type NewContactRecord } from "@/domain/objects/ContactRecord";

export type ContactRow = {
    notification_id: number; lead_id: number; title: string | null; date: string | null;
    contact_direction?: ContactDetails["direction"] | null;
    contact_channel?: ContactDetails["channel"] | null;
    contact_outcome?: ContactDetails["outcome"] | null;
    contact_notes?: string | null; next_follow_up_at?: string | null;
};

export function contactDetailsFromRow(row: Partial<Omit<ContactRow, "lead_id">>): ContactDetails | null {
    if (!row.contact_direction || !contactDirections.includes(row.contact_direction)
        || !row.contact_channel || !contactChannels.includes(row.contact_channel)
        || !row.contact_outcome || !contactOutcomes.includes(row.contact_outcome)) return null;
    return { direction: row.contact_direction, channel: row.contact_channel, outcome: row.contact_outcome,
        notes: row.contact_notes ?? "", nextFollowUpAt: row.next_follow_up_at ?? null };
}

export function contactFromRow(row: ContactRow): ContactRecord {
    return { notificationID: row.notification_id, leadID: row.lead_id, title: row.title ?? "",
        occurredAt: row.date, details: contactDetailsFromRow(row) };
}

function databaseError(error: { message: string; code?: string }): Error {
    if (["PGRST202", "PGRST204", "42703", "42883"].includes(error.code ?? "")) {
        return new Error("Contact history is unavailable until the contact history database migration is applied.");
    }
    return new Error(error.message);
}

export class ContactHistoryRepo {
    static readonly PAGE_SIZE = 50;
    constructor(private readonly client: SupabaseClient = supabase) {}

    async getPage(leadID: number, offset = 0): Promise<{ records: ContactRecord[]; hasMore: boolean }> {
        // select * deliberately supports legacy rows and databases before the additive migration.
        const { data, error } = await this.client.from("notifications").select("*").eq("lead_id", leadID)
            .order("date", { ascending: false, nullsFirst: false })
            .order("notification_id", { ascending: false })
            .range(offset, offset + ContactHistoryRepo.PAGE_SIZE);
        if (error) throw databaseError(error);
        if (!data) throw new Error("Could not load contact history.");
        return { records: (data as ContactRow[]).slice(0, ContactHistoryRepo.PAGE_SIZE).map(contactFromRow),
            hasMore: data.length > ContactHistoryRepo.PAGE_SIZE };
    }

    async record(input: NewContactRecord): Promise<ContactRecord> {
        const validation = validateContactRecord(input);
        if (validation) throw new Error(validation);
        // Score against a fresh version. The transaction rejects concurrent lead changes.
        for (let attempt = 0; attempt < 3; attempt++) {
            const snapshot = await this.client.from("leads").select("*").eq("lead_id", input.leadID).single();
            if (snapshot.error) throw databaseError(snapshot.error);
            if (!snapshot.data) throw new Error("Lead not found.");
            const row = snapshot.data;
            const isLatest = !row.last_interaction_date || Date.parse(input.occurredAt) >= Date.parse(row.last_interaction_date);
            const lead = new Lead({ leadID: input.leadID, firstName: row.first_name ?? "Lead",
                stage: row.stage ?? "NEW", notes: row.notes ?? "", status: row.status ?? true,
                createdAt: row.created_at ? new Date(row.created_at) : new Date(),
                lastInteractionDate: isLatest ? new Date(input.occurredAt) : new Date(row.last_interaction_date),
                lastInteractionBy: isLatest ? (input.direction === "inbound" ? "LEAD" : "USER") : (row.last_interaction_by ?? "") });
            const result = await this.client.rpc("autotrack_record_contact", {
                p_lead_id: input.leadID, p_request_id: input.requestID,
                p_direction: input.direction, p_channel: input.channel, p_outcome: input.outcome,
                p_occurred_at: input.occurredAt, p_notes: input.notes.trim(),
                p_next_follow_up_at: input.nextFollowUpAt, p_time_zone: input.timeZone,
                p_expected_version: row.version, p_score: new ScoringService().calculateScore(lead),
            });
            if (result.error?.code === "40001") continue;
            if (result.error) throw databaseError(result.error);
            if (!result.data) throw new Error("Contact save returned no confirmation. Retry with the same request.");
            return contactFromRow(result.data as ContactRow);
        }
        throw new Error("This lead changed while saving. Retry to save against the latest version.");
    }
}
