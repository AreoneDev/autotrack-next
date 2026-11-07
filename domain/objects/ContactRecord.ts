export const contactDirections = ["outbound", "inbound"] as const;
export const contactChannels = ["call", "email", "message", "in_person", "other"] as const;
export const contactOutcomes = ["connected", "no_answer", "voicemail", "sent", "received", "other"] as const;

export type ContactDirection = typeof contactDirections[number];
export type ContactChannel = typeof contactChannels[number];
export type ContactOutcome = typeof contactOutcomes[number];

/** Explicitly entered contact facts. A legacy notification has no contact details. */
export interface ContactDetails {
    direction: ContactDirection;
    channel: ContactChannel;
    outcome: ContactOutcome;
    notes: string;
    nextFollowUpAt: string | null;
}

export interface ContactRecord {
    notificationID: number;
    leadID: number;
    title: string;
    occurredAt: string | null;
    details: ContactDetails | null;
}

export interface NewContactRecord extends ContactDetails {
    leadID: number;
    occurredAt: string;
    /** Keep the same key when retrying an uncertain network result. */
    requestID: string;
    timeZone: string;
}

export function validateContactRecord(record: NewContactRecord): string | null {
    if (!Number.isSafeInteger(record.leadID) || record.leadID <= 0) return "A valid lead is required.";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.requestID)) return "A valid request ID is required.";
    if (!contactDirections.includes(record.direction)) return "Choose a contact direction.";
    if (!contactChannels.includes(record.channel)) return "Choose a contact channel.";
    if (!contactOutcomes.includes(record.outcome)) return "Choose a contact result.";
    if (record.notes.length > 10000) return "Contact notes must be 10,000 characters or fewer.";
    try { new Intl.DateTimeFormat("en", { timeZone: record.timeZone }); }
    catch { return "Choose a valid time zone."; }
    const occurred = Date.parse(record.occurredAt);
    if (!Number.isFinite(occurred)) return "Enter a valid contact date and time.";
    if (occurred > Date.now() + 60000) return "Contact time cannot be in the future. Use next follow-up for planned contact.";
    if (record.direction === "inbound" && !["connected", "received", "other"].includes(record.outcome)) return "Choose received, connected, or other for incoming contact.";
    if (record.direction === "outbound" && record.outcome === "received") return "Received is only available for incoming contact.";
    if (record.nextFollowUpAt !== null) {
        const next = Date.parse(record.nextFollowUpAt);
        if (!Number.isFinite(next) || next <= occurred) return "Next follow-up must be after the contact time.";
    }
    return null;
}
