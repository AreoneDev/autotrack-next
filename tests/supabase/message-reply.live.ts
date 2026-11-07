import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.AUTOTRACK_TEST_URL;
if (!/^autotrack-security-[0-9a-f]{8}$/.test(process.env.AUTOTRACK_DISPOSABLE_RUN ?? "") ||
    url !== "http://127.0.0.1:56421") {
    throw new Error("Use npm run test:supabase with its disposable local stack.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const anonymous = () => createClient(url!, process.env.AUTOTRACK_TEST_ANON_KEY!, options);
let owner: SupabaseClient, other: SupabaseClient;
let incomingId: number, secondId: number, outboundId: number;
beforeAll(async () => {
    const admin = createClient(url!, process.env.AUTOTRACK_TEST_SERVICE_KEY!, options);
    async function actor() {
        const email = randomUUID() + "@example.invalid";
        const password = randomUUID() + "aA1!";
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error).toBeNull();
        const db = anonymous();
        expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();
        return db;
    }
    owner = await actor();
    other = await actor();
    const lead = await owner.from("leads").insert({ first_name: "Reply test" }).select().single();
    expect(lead.error).toBeNull();
    const rows = await owner.from("notifications").insert(["inbound", "inbound", "outbound"].map(contact_direction => ({
        lead_id: lead.data!.lead_id, title: "Synthetic contact", date: "2026-01-01T12:00:00Z", contact_direction,
    }))).select();
    expect(rows.error).toBeNull();
    [incomingId, secondId, outboundId] = rows.data!.map(row => row.notification_id);
});

it("rejects other-owner, anonymous, outbound and missing acknowledgements", async () => {
    for (const [db, id] of [[other, incomingId], [anonymous(), incomingId], [owner, outboundId], [owner, -1]] as const) {
        expect((await db.rpc("mark_notification_replied", { p_notification_id: id })).error).not.toBeNull();
    }
    const untouched = await owner.from("notifications").select("replied_at").eq("notification_id", incomingId).single();
    expect(untouched.data?.replied_at).toBeNull();
});

it("acknowledges only the selected incoming contact and preserves its first timestamp", async () => {
    expect((await owner.rpc("mark_notification_replied", { p_notification_id: incomingId })).error).toBeNull();
    const first = await owner.from("notifications").select("replied_at").eq("notification_id", incomingId).single();
    expect(first.data?.replied_at).toBeTruthy();
    expect((await owner.rpc("mark_notification_replied", { p_notification_id: incomingId })).error).toBeNull();
    const repeated = await owner.from("notifications").select("replied_at").eq("notification_id", incomingId).single();
    expect(repeated.data?.replied_at).toBe(first.data?.replied_at);
    const second = await owner.from("notifications").select("replied_at").eq("notification_id", secondId).single();
    expect(second.data?.replied_at).toBeNull();
});

it("rejects reply timestamps on an outbound contact even through direct updates", async () => {
    const result = await owner.from("notifications").update({ replied_at: new Date().toISOString() })
        .eq("notification_id", outboundId);
    expect(result.error?.code).toBe("23514");
});

