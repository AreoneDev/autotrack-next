import type { SupabaseClient } from "@supabase/supabase-js";
import { ScoringService } from "@/domain/business/ScoringService";
import { Notification } from "@/domain/objects/Notification";
import { supabase } from "@/lib/supabase/client";
import { type LeadRow, mapRowToLead } from "./LeadRepo";

export type CommunicationChannel = "call" | "email" | "message";

export interface CommunicationOperation {
    operationId: string;
    leadId: number;
    channel: CommunicationChannel;
    occurredAt: string;
}

export class CommunicationRepo {
    constructor(private readonly client: SupabaseClient = supabase) {}

    async logCommunication(operation: CommunicationOperation) {
        const occurredAt = new Date(operation.occurredAt);
        if (!Number.isSafeInteger(operation.leadId) || operation.leadId <= 0
            || !["call", "email", "message"].includes(operation.channel)
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.operationId)
            || !Number.isFinite(occurredAt.getTime())) {
            throw new Error("Invalid communication.");
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            // Score the latest row, never the potentially stale detail form.
            const { data: row, error: readError } = await this.client.from("leads")
                .select("*").eq("lead_id", operation.leadId).maybeSingle();
            if (readError) throw new Error(readError.message);
            if (!row) throw new Error("Lead not found.");
            const lead = mapRowToLead(row as LeadRow);
            if (!lead.lastInteractionDate || occurredAt >= lead.lastInteractionDate) {
                lead.recordInteraction(occurredAt, "USER");
            }
            const { data, error } = await this.client.rpc("autotrack_log_communication", {
                p_lead_id: operation.leadId,
                p_operation_id: operation.operationId,
                p_channel: operation.channel,
                p_occurred_at: occurredAt.toISOString(),
                p_expected_version: row.version,
                p_score: new ScoringService().calculateScore(lead),
            });
            if (error?.code === "40001" && attempt < 2) continue;
            if (error?.code === "PGRST202") {
                throw new Error("Communication logging is unavailable. Apply the communication sync migration first.");
            }
            if (error) throw new Error(error.message);
            if (!data?.lead || !data?.notification) {
                throw new Error("Unable to confirm communication. Retry to check the saved result.");
            }
            const savedLead = mapRowToLead(data.lead as LeadRow);
            return {
                lead: savedLead,
                notification: new Notification(savedLead, data.notification.title,
                    new Date(data.notification.date), data.notification.notification_id),
            };
        }
        throw new Error("Lead changed while logging communication. Retry.");
    }
}
