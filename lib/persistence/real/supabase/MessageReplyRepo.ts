import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageReplyRecord } from "@/domain/business/MessageReplyService";

export type MessageReplyResult =
    | { available: true; records: MessageReplyRecord[] }
    | { available: false; records: [] };

export class MessageReplyRepo {
    constructor(private readonly client: SupabaseClient) {}

    async getRecords(leadId?: number): Promise<MessageReplyResult> {
        try {
            const records: MessageReplyRecord[] = [];
            const pageSize = 500;
            for (let offset = 0; ; offset += pageSize) {
                let query = this.client.from("notifications")
                    .select("notification_id,lead_id,title,date,contact_direction,replied_at")
                    .order("notification_id", { ascending: true });
                if (leadId !== undefined) query = query.eq("lead_id", leadId);
                const { data, error } = await query.range(offset, offset + pageSize - 1);
                // Missing migrations, denied access and partial reads are unavailable, never zero.
                if (error || !data) return { available: false, records: [] };
                records.push(...data as MessageReplyRecord[]);
                if (data.length < pageSize) return { available: true, records };
            }
        } catch {
            return { available: false, records: [] };
        }
    }

    async markReplied(notificationId: number): Promise<string | null> {
        try {
            const { error } = await this.client.rpc("mark_notification_replied", {
                p_notification_id: notificationId,
            });
            return error ? "Could not save reply status. Please retry." : null;
        } catch {
            return "Could not save reply status. Please retry.";
        }
    }
}

