import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageReplyRepo } from "@/lib/persistence/real/supabase/MessageReplyRepo";
import { scriptedClient } from "@/tests/helpers/supabase";

it("distinguishes unavailable schema/access from a successfully empty inbox", async () => {
    for (const reply of [{ error: { message: "column missing" } }, { data: null }]) {
        expect(await new MessageReplyRepo(scriptedClient([reply]).client).getRecords()).toEqual({ available: false, records: [] });
    }
    expect(await new MessageReplyRepo(scriptedClient([{ data: [] }]).client).getRecords()).toEqual({ available: true, records: [] });
});

it("reads beyond the default page and scopes a detail read to one lead", async () => {
    const db = scriptedClient([{ data: Array.from({ length: 500 }, (_, notification_id) => ({ notification_id })) }, { data: [{ notification_id: 501 }] }]);
    const result = await new MessageReplyRepo(db.client).getRecords(7);
    expect(result.records).toHaveLength(501);
    expect(db.queries[0].eq).toHaveBeenCalledWith("lead_id", 7);
    expect(db.queries[1].range).toHaveBeenCalledWith(500, 999);
});

it("discards partial statistics if any later page fails", async () => {
    const db = scriptedClient([{ data: Array(500).fill({ notification_id: 1 }) }, { error: { message: "offline" } }]);
    expect(await new MessageReplyRepo(db.client).getRecords()).toEqual({ available: false, records: [] });
});

it("does not expose raw errors and sends only the selected id to the scoped RPC", async () => {
    const rpc = jest.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "internal detail" } }).mockRejectedValueOnce(new Error("offline"));
    const repo = new MessageReplyRepo({ rpc } as unknown as SupabaseClient);
    expect(await repo.markReplied(7)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("mark_notification_replied", { p_notification_id: 7 });
    expect(await repo.markReplied(7)).toMatch(/retry/);
    expect(await repo.markReplied(7)).toMatch(/retry/);
});

