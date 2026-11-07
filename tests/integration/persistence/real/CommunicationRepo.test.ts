import type { SupabaseClient } from "@supabase/supabase-js";
import { CommunicationRepo, type CommunicationOperation } from "@/lib/persistence/real/supabase/CommunicationRepo";
import { scriptedClient } from "@/tests/helpers/supabase";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const operation: CommunicationOperation = {
    operationId: "12345678-1234-4234-8234-123456789abc",
    leadId: 7, channel: "call", occurredAt: "2026-11-07T15:12:34.567Z",
};
const row = {
    lead_id: 7, first_name: "Ada", stage: "CONTACTED", notes: "",
    created_at: "2026-01-01T15:00:00Z", version: 4,
    last_interaction_date: "2026-11-06T15:00:00Z", last_interaction_by: "LEAD",
};
const saved = {
    lead: { ...row, last_interaction_date: operation.occurredAt, last_interaction_by: "USER", score: 35 },
    notification: { notification_id: 9, title: "You called Ada", date: operation.occurredAt },
};

function repository(reads: Parameters<typeof scriptedClient>[0], rpc = jest.fn().mockResolvedValue({ data: saved, error: null })) {
    const db = scriptedClient(reads);
    const client = Object.assign(db.client, { rpc }) as unknown as SupabaseClient;
    return { ...db, rpc, repo: new CommunicationRepo(client) };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-11-07T15:13:00Z")));
afterEach(() => jest.useRealTimers());

it.each(["call", "email", "message"] as const)("atomically logs %s with a fresh score and unchanged retry identity", async (channel) => {
    const db = repository([{ data: row }]);
    const result = await db.repo.logCommunication({ ...operation, channel });
    expect(db.rpc).toHaveBeenCalledWith("autotrack_log_communication", {
        p_lead_id: 7, p_operation_id: operation.operationId, p_channel: channel,
        p_occurred_at: operation.occurredAt, p_expected_version: 4, p_score: 35,
    });
    expect(result.lead.lastInteractionDate?.toISOString()).toBe(operation.occurredAt);
    expect(result.lead.lastInteractionBy).toBe("USER");
    expect(result.notification.getEventID()).toBe(9);
    expect(db.queries[0].insert).not.toHaveBeenCalled();
    expect(db.queries[0].update).not.toHaveBeenCalled();
});

it("recalculates after a version conflict without changing the event or retry key", async () => {
    const rpc = jest.fn().mockResolvedValueOnce({ error: { code: "40001", message: "Changed" } })
        .mockResolvedValueOnce({ data: saved, error: null });
    const db = repository([{ data: row }, { data: { ...row, stage: "NEGOTIATION", version: 5 } }], rpc);
    await db.repo.logCommunication(operation);
    expect(rpc.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ p_expected_version: 4, p_score: 35, p_operation_id: operation.operationId }),
        expect.objectContaining({ p_expected_version: 5, p_score: 110, p_operation_id: operation.operationId }),
    ]);
});

it("keeps a newer inbound contact when a delayed outbound event is logged", async () => {
    const newer = { ...row, last_interaction_date: "2026-11-07T15:12:59Z" };
    const db = repository([{ data: newer }], jest.fn().mockResolvedValue({ data: { ...saved, lead: newer } }));
    const result = await db.repo.logCommunication(operation);
    expect(db.rpc.mock.calls[0][1].p_score).toBe(65);
    expect(result.lead.lastInteractionBy).toBe("LEAD");
    expect(result.lead.lastInteractionDate?.toISOString()).toBe("2026-11-07T15:12:59.000Z");
});

it.each([
    { data: null, error: { message: "Read failed" } },
    { data: null, error: null },
])("does not write after a failed or missing lead read", async (read) => {
    const db = repository([read]);
    await expect(db.repo.logCommunication(operation)).rejects.toThrow(read.error?.message ?? "Lead not found.");
    expect(db.rpc).not.toHaveBeenCalled();
});

it.each([
    [{ error: { code: "PGRST202", message: "Not found" } }, "migration first"],
    [{ error: { message: "Write failed" } }, "Write failed"],
    [{ data: null, error: null }, "Unable to confirm"],
])("reports RPC failures without falling back to partial writes", async (reply, message) => {
    const db = repository([{ data: row }], jest.fn().mockResolvedValue(reply));
    await expect(db.repo.logCommunication(operation)).rejects.toThrow(message as string);
    expect(db.from).toHaveBeenCalledTimes(1);
});

it("bounds conflict retries", async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { code: "40001", message: "Changed" } });
    const db = repository(Array.from({ length: 3 }, () => ({ data: row })), rpc);
    await expect(db.repo.logCommunication(operation)).rejects.toThrow("Changed");
    expect(rpc).toHaveBeenCalledTimes(3);
});
