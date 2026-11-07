import { getMessageReplyState, summarizeMessageReplies, type MessageReplyRecord } from "@/domain/business/MessageReplyService";

const now = new Date("2026-11-07T16:00:00Z");
const incoming = (overrides: Partial<MessageReplyRecord> = {}): MessageReplyRecord => ({
    notification_id: 1, lead_id: 7, title: "Customer response", date: "2026-11-07T14:00:00Z",
    contact_direction: "inbound", replied_at: null, ...overrides,
});

it("tracks each explicitly received contact until explicitly marked replied", () => {
    expect(getMessageReplyState(incoming(), now)).toBe("pending_reply");
    expect(getMessageReplyState(incoming({ replied_at: "2026-11-07T15:00:00Z" }), now)).toBe("replied");
    expect(summarizeMessageReplies([
        incoming(), incoming({ notification_id: 2, replied_at: "2026-11-07T15:00:00Z" }),
        incoming({ notification_id: 3, contact_direction: "outbound" }),
    ], now)).toEqual({ received: 2, pending: 1, replied: 1, unknown: 1 });
});

it("never interprets a title, latest USER interaction or outbound contact as a reply", () => {
    expect(getMessageReplyState(incoming({ contact_direction: null, title: "Customer replied!" }), now)).toBe("unknown");
    expect(summarizeMessageReplies([incoming(), incoming({ contact_direction: "outbound", date: "2026-11-07T15:00:00Z" })], now).pending).toBe(1);
});

it.each([
    { date: null }, { date: "invalid" }, { date: "2026-11-08T00:00:00Z" }, { lead_id: null },
    { replied_at: "invalid" }, { replied_at: "2026-11-07T13:00:00Z" }, { replied_at: "2026-11-08T00:00:00Z" },
])("excludes incomplete or inconsistent records: %j", overrides => {
    expect(getMessageReplyState(incoming(overrides), now)).toBe("unknown");
});

it("counts multiple incoming contacts independently, including contacts after an acknowledgement", () => {
    expect(summarizeMessageReplies([
        incoming({ replied_at: "2026-11-07T15:00:00Z" }),
        incoming({ notification_id: 2, date: "2026-11-07T15:30:00Z" }),
        incoming({ notification_id: 3, date: "2026-11-07T15:45:00Z" }),
    ], now)).toMatchObject({ received: 3, pending: 2, replied: 1 });
});

