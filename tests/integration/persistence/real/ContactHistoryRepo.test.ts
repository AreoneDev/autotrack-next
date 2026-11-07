import type { SupabaseClient } from "@supabase/supabase-js";
import { ContactHistoryRepo, contactFromRow } from "@/lib/persistence/real/supabase/ContactHistoryRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { validateContactRecord, type NewContactRecord } from "@/domain/objects/ContactRecord";
import { scriptedClient } from "@/tests/helpers/supabase";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
const input: NewContactRecord = { leadID: 7, requestID: "11111111-1111-4111-8111-111111111111", timeZone: "America/Toronto",
    direction: "inbound", channel: "email", outcome: "received", notes: " Customer asked for a quote. ",
    occurredAt: "2026-01-01T15:00:00.000Z", nextFollowUpAt: "2026-01-02T15:00:00.000Z" };
const saved = { notification_id: 9, lead_id: 7, title: "Received email: received", date: input.occurredAt,
    contact_direction: "inbound" as const, contact_channel: "email" as const, contact_outcome: "received" as const,
    contact_notes: input.notes.trim(), next_follow_up_at: input.nextFollowUpAt };
const lead = { lead_id: 7, first_name: "Ada", stage: "CONTACTED", notes: "", status: true, created_at: "2025-01-01T00:00:00Z", version: 4, last_interaction_date: null };

describe("Contact history read and transaction contracts", () => {
    it("keeps legacy records unknown and preserves missing time", () => {
        expect(contactFromRow({ notification_id: 1, lead_id: 7, title: "You called Ada", date: null })).toEqual({
            notificationID: 1, leadID: 7, title: "You called Ada", occurredAt: null, details: null });
    });
    it("paginates deterministically with one lookahead row", async () => {
        const db = scriptedClient([{ data: Array.from({ length: 51 }, (_, index) => ({ ...saved, notification_id: index + 1 })) }]);
        const page = await new ContactHistoryRepo(db.client).getPage(7, 50);
        expect(page.records).toHaveLength(50); expect(page.hasMore).toBe(true);
        expect(db.queries[0].eq).toHaveBeenCalledWith("lead_id", 7);
        expect(db.queries[0].range).toHaveBeenCalledWith(50, 100);
        expect(db.queries[0].order).toHaveBeenCalledWith("notification_id", { ascending: false });
    });
    it("reports read errors instead of claiming the history is empty", async () => {
        const db = scriptedClient([{ error: { message: "Permission denied" } }]);
        await expect(new ContactHistoryRepo(db.client).getPage(7)).rejects.toThrow("Permission denied");
    });
    it("commits a structured record with optimistic version and trimmed notes", async () => {
        const db = scriptedClient([{ data: lead }]);
        const rpc = jest.fn().mockResolvedValue({ data: saved, error: null });
        const client = Object.assign(db.client, { rpc }) as unknown as SupabaseClient;
        expect(await new ContactHistoryRepo(client).record(input)).toMatchObject({ notificationID: 9, details: { direction: "inbound", notes: input.notes.trim() } });
        expect(rpc).toHaveBeenCalledWith("autotrack_record_contact", expect.objectContaining({
            p_expected_version: 4, p_direction: "inbound", p_request_id: input.requestID,
            p_notes: input.notes.trim(), p_time_zone: "America/Toronto", p_next_follow_up_at: input.nextFollowUpAt }));
    });
    it("recalculates on version conflict without changing the request ID", async () => {
        const db = scriptedClient([{ data: lead }, { data: { ...lead, version: 5 } }]);
        const rpc = jest.fn().mockResolvedValueOnce({ error: { code: "40001", message: "Changed" } }).mockResolvedValueOnce({ data: saved });
        await new ContactHistoryRepo(Object.assign(db.client, { rpc })).record(input);
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(rpc.mock.calls.map(call => call[1].p_expected_version)).toEqual([4, 5]);
        expect(rpc.mock.calls.map(call => call[1].p_request_id)).toEqual([input.requestID, input.requestID]);
    });
    it("leaves newer contact summaries intact when calculating backdated contact score", async () => {
        const db = scriptedClient([{ data: { ...lead, last_interaction_date: "2026-02-01T00:00:00Z", last_interaction_by: "USER" } }]);
        const rpc = jest.fn().mockResolvedValue({ data: saved });
        await new ContactHistoryRepo(Object.assign(db.client, { rpc })).record(input);
        expect(rpc.mock.calls[0][1].p_score).toBe(0); // Old USER contact: no recent-reply boost.
    });
    it("reports a missing migration and never falls back to a partial notification insert", async () => {
        const db = scriptedClient([{ data: lead }]);
        const rpc = jest.fn().mockResolvedValue({ error: { code: "PGRST202", message: "Not found" } });
        await expect(new ContactHistoryRepo(Object.assign(db.client, { rpc })).record(input)).rejects.toThrow("database migration");
        expect(db.from).toHaveBeenCalledTimes(1);
        expect(db.queries[0].insert).not.toHaveBeenCalled();
    });
    it("notification domain mapping exposes contact details without clearing independent reply state on updates", async () => {
        const db = scriptedClient([{ data: { ...saved, replied_at: "2026-01-02T15:00:00Z" } }, { data: saved }, {}]);
        const repo = new NotificationRepo(db.client);
        const notification = (await repo.getNotificationById(9))!;
        expect(notification.getContactDetails()).toMatchObject({ direction: "inbound", outcome: "received" });
        await repo.updateNotification(notification);
        const payload = db.queries[2].update.mock.calls[0][0];
        expect(payload).not.toHaveProperty("replied_at"); expect(payload).not.toHaveProperty("contact_direction");
    });
    it.each([
        [{ direction: "inbound", outcome: "no_answer" }, "incoming"],
        [{ direction: "outbound", outcome: "received" }, "incoming"],
        [{ nextFollowUpAt: "2025-01-01T00:00:00Z" }, "after"],
        [{ occurredAt: "invalid" }, "valid contact"],
        [{ timeZone: "Invalid/Zone" }, "time zone"],
        [{ notes: "a".repeat(10001) }, "10,000"],
    ])("rejects invalid input before a write (%j)", (changes, expected) => {
        expect(validateContactRecord({ ...input, ...changes } as NewContactRecord)).toContain(expected);
    });
});
