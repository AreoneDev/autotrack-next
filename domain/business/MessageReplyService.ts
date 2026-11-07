export type MessageReplyRecord = {
    notification_id: number;
    lead_id: number | null;
    title: string | null;
    date: string | null;
    contact_direction: string | null;
    replied_at: string | null;
};

export type MessageReplyState = "pending_reply" | "replied" | "unknown";

export function getMessageReplyState(record: MessageReplyRecord, now: Date): MessageReplyState {
    const received = record.date ? Date.parse(record.date) : NaN;
    if (record.contact_direction !== "inbound" || !record.lead_id ||
        !Number.isFinite(received) || received > now.getTime()) return "unknown";
    if (record.replied_at === null) return "pending_reply";
    const replied = Date.parse(record.replied_at);
    return Number.isFinite(replied) && replied >= received && replied <= now.getTime()
        ? "replied" : "unknown";
}

export function summarizeMessageReplies(records: MessageReplyRecord[], now: Date) {
    let pending = 0;
    let replied = 0;
    let unknown = 0;
    for (const record of records) {
        const state = getMessageReplyState(record, now);
        if (state === "pending_reply") pending++;
        else if (state === "replied") replied++;
        else unknown++;
    }
    return { received: pending + replied, pending, replied, unknown };
}

