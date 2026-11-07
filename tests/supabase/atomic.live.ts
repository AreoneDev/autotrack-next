import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.AUTOTRACK_TEST_URL;
if (!/^autotrack-security-[0-9a-f]{8}$/.test(process.env.AUTOTRACK_DISPOSABLE_RUN ?? "")
    || url !== "http://127.0.0.1:56421") {
    throw new Error("Use npm run test:supabase with its disposable local stack.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let db: SupabaseClient;
beforeAll(async () => {
    const admin = createClient(url!, process.env.AUTOTRACK_TEST_SERVICE_KEY!, options);
    const email = "atomic-" + randomUUID() + "@example.invalid";
    const password = randomUUID() + "aA1!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    db = createClient(url!, process.env.AUTOTRACK_TEST_ANON_KEY!, options);
    expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();
});
const selection = (trim: string) => ({ year: "2026", make: "Synthetic", model: "Catalogue", trim });
async function lead() {
    const { data, error } = await db.from("leads").insert({ first_name: "Before" }).select().single();
    expect(error).toBeNull();
    return data;
}
function draft(id: number, name: string, request = randomUUID(), version = 1) {
    return { p_lead_id: id, p_expected_version: version, p_request_id: request,
        p_details: { first_name: name }, p_interest: selection(name), p_trade_in: selection(name) };
}

it("stale editor: the second aggregate save changes nothing", async () => {
    const row = await lead();
    const first = await db.rpc("autotrack_save_lead_details", draft(row.lead_id, "Editor A"));
    expect(first.error).toBeNull();
    const stale = await db.rpc("autotrack_save_lead_details", draft(row.lead_id, "Editor B"));
    expect(stale.error?.code).toBe("40001");
    const saved = await db.from("leads").select().eq("lead_id", row.lead_id).single();
    expect(saved.error).toBeNull();
    expect(saved.data.version).toBe(2);
    for (const table of ["lead_vehicle_interests", "lead_trade_in_vehicles"]) {
        const link = await db.from(table).select().eq("lead_id", row.lead_id).single();
        expect(link.error).toBeNull();
        expect(link.data).toMatchObject({ vehicle_id: 1, trim_override: saved.data.first_name });
    }
}, 120_000);

it("duplicate requests and a lost-response retry commit only once", async () => {
    const row = await lead();
    const payload = draft(row.lead_id, "Retry");
    const first = await db.rpc("autotrack_save_lead_details", payload);
    const retry = await db.rpc("autotrack_save_lead_details", payload);
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(first.data.version).toBe(2);
    expect(retry.data).toEqual(first.data);
    // A replay after a later committed save must return the original receipt
    // without overwriting the later editor or incrementing the current version.
    expect((await db.rpc("autotrack_save_lead_details", draft(row.lead_id, "Later", randomUUID(), 2))).error).toBeNull();
    const replay = await db.rpc("autotrack_save_lead_details", payload);
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
    const saved = await db.from("leads").select().eq("lead_id", row.lead_id).single();
    expect(saved.data).toMatchObject({ first_name: "Later", version: 3 });
    const receipts = await db.from("lead_save_requests").select().eq("lead_id", row.lead_id);
    expect(receipts.error).toBeNull();
    expect(receipts.data).toHaveLength(2);
});
