// Disposable embedded PostgreSQL: no network, secrets or hosted database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "../../.test-runtime/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
// Optional peer migration paths allow integration verification without merging branches.
const [syncMigrationPath, replyMigrationPath] = process.argv.slice(2);
let passed = 0;
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const read = name => readFile(new URL(name, import.meta.url), "utf8");
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
async function rows(sql, args = []) { return (await db.query(sql, args)).rows; }
async function actor(id) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id })]);
    await db.exec("set role authenticated");
}
const request = (id = 1) => `30000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
async function record(overrides = {}) {
    const data = { lead: 2, request: request(), direction: "inbound", channel: "email", outcome: "received",
        occurred: "2026-01-01T15:00:00Z", notes: "Quote café 🚗 <script>literal</script>",
        follow: "2026-01-02T15:00:00Z", zone: "America/Toronto", version: 1, score: 65, ...overrides };
    return (await rows("select public.autotrack_record_contact($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as contact", Object.values(data)))[0].contact;
}
async function rejected(fn, code) { await assert.rejects(fn, error => error.code === code); }
try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key, email text unique);
      create function auth.uid() returns uuid language sql stable as $$
        select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;`);
    await db.exec((await read("../supabase/legacy-schema.sql")).replace(":'legacy_owner_email'", "'synthetic-owner@example.invalid'"));
    // Adapt only the historical lookup literal to an inert local fixture.
    await db.exec((await read("../../supabase/migrations/20261025160000_per_user_data_access.sql"))
        .replace(/lower\('[^']+@[^']+'\)/, "lower('synthetic-owner@example.invalid')"));
    await db.exec(await read("../../supabase/migrations/20261031010000_restrict_extra_table_privileges.sql"));
    if (syncMigrationPath) await db.exec(await readFile(syncMigrationPath, "utf8"));
    await db.exec(await read("../../supabase/migrations/20261107130000_complete_contact_history.sql"));
    if (replyMigrationPath) await db.exec(await readFile(replyMigrationPath, "utf8"));
    await db.exec(`grant usage, select on all sequences in schema public to authenticated;
        insert into auth.users(id,email) values ('${a}','a@example.invalid'),('${b}','b@example.invalid');
        insert into public.leads(lead_id,owner_id,first_name,stage,score) values
          (2,'${a}','A','CONTACTED',35),(3,'${b}','B','CONTACTED',35);`);

    await test("legacy row and ownership survive additive migration", async () => {
        const [legacy] = await rows("select * from public.notifications where notification_id=1");
        assert.equal(legacy.title, "Legacy notification"); assert.equal(legacy.contact_direction, null);
        assert.equal(legacy.contact_channel, null); assert.equal(legacy.contact_outcome, null);
    });
    await actor(a);
    let first;
    await test("atomic inbound record, summary and exact local follow-up task", async () => {
        first = await record();
        assert.equal(first.contact_direction, "inbound"); assert.equal(first.contact_notes, "Quote café 🚗 <script>literal</script>");
        const [lead] = await rows("select last_interaction_by,score,follow_up_date from public.leads where lead_id=2");
        assert.equal(lead.last_interaction_by, "LEAD"); assert.equal(lead.score, 65);
        assert.equal(new Date(lead.follow_up_date).toISOString(), "2026-01-02T15:00:00.000Z");
        const [task] = await rows("select to_char(task_date,'YYYY-MM-DD HH24:MI') as local_time,completed,notes from public.tasks where lead_id=2");
        assert.equal(task.local_time, "2026-01-02 10:00"); assert.equal(task.completed, false); assert.equal(task.notes, first.contact_notes);
    });
    await test("lost-response retry creates neither a second record nor task", async () => {
        assert.equal((await record()).notification_id, first.notification_id);
        assert.equal((await rows("select count(*)::integer as n from public.notifications where lead_id=2"))[0].n, 1);
        assert.equal((await rows("select count(*)::integer as n from public.tasks where lead_id=2"))[0].n, 1);
    });
    await test("request key cannot silently save changed details", async () => {
        await rejected(() => record({ notes: "Different" }), "22023");
    });
    await test("stale lead version rejects the entire write", async () => {
        await rejected(() => record({ request: request(2), version: 1, follow: null }), "40001");
        assert.equal((await rows("select count(*)::integer as n from public.notifications where lead_id=2"))[0].n, 1);
    });
    await test("backdated history does not replace the newer summary", async () => {
        const [{ version }] = await rows("select version from public.leads where lead_id=2");
        await record({ request: request(3), direction: "outbound", outcome: "sent", occurred: "2025-12-01T15:00:00Z", follow: null, version, score: 5 });
        const [lead] = await rows("select last_interaction_by,score from public.leads where lead_id=2");
        assert.equal(lead.last_interaction_by, "LEAD"); assert.equal(lead.score, 65);
    });
    await test("two contacts can keep separate follow-up tasks on the same day", async () => {
        const [{ version }] = await rows("select version from public.leads where lead_id=2");
        await record({ request: request(10), version });
        const tasks = await rows("select title from public.tasks where lead_id=2");
        assert.equal(tasks.length, 2); assert.equal(new Set(tasks.map(task => task.title)).size, 2);
    });
    await test("outgoing contact records USER", async () => {
        const [{ version }] = await rows("select version from public.leads where lead_id=2");
        await record({ request: request(4), direction: "outbound", outcome: "no_answer", occurred: "2026-02-01T15:00:00Z", follow: null, version, score: 35 });
        assert.equal((await rows("select last_interaction_by from public.leads where lead_id=2"))[0].last_interaction_by, "USER");
    });
    if (replyMigrationPath) await test("peer reply RPC marks only the selected incoming contact; outgoing entry does not clear it", async () => {
        await db.query("select public.mark_notification_replied($1)", [first.notification_id]);
        const [before] = await rows("select replied_at from public.notifications where notification_id=$1", [first.notification_id]);
        assert.ok(before.replied_at);
        const [{ version }] = await rows("select version from public.leads where lead_id=2");
        const outgoing = await record({ request: request(11), direction: "outbound", outcome: "sent", occurred: "2026-02-02T15:00:00Z", version, follow: null });
        assert.equal(outgoing.replied_at, null);
        assert.deepEqual((await rows("select replied_at from public.notifications where notification_id=$1", [first.notification_id]))[0], before);
        await rejected(() => db.query("select public.mark_notification_replied($1)", [outgoing.notification_id]), "P0001");
    });
    await test("other owner cannot read, mutate or log contact against this lead", async () => {
        await actor(b);
        assert.equal((await rows("select * from public.notifications where lead_id=2")).length, 0);
        assert.equal((await rows("update public.notifications set contact_notes='hijacked' where lead_id=2 returning *")).length, 0);
        await rejected(() => record({ request: request(5) }), "42501");
        await rejected(() => db.query("insert into public.notifications(lead_id,title) values (2,'cross-owner')"), "42501");
    });
    await test("anonymous callers cannot execute the contact transaction", async () => {
        await db.exec("reset role; set role anon");
        await rejected(() => record({ request: request(6) }), "42501");
        await actor(a);
    });
    if (syncMigrationPath) await test("peer quick-contact RPC and its retry key coexist with structured contact fields", async () => {
        await actor(b);
        const values = [3, request(50), "call", "2026-01-01T15:00:00Z", 1, 35];
        const sql = "select public.autotrack_log_communication($1,$2,$3,$4,$5,$6) as result";
        const [saved] = await rows(sql, values);
        const [retry] = await rows(sql, values);
        assert.equal(saved.result.notification.notification_id, retry.result.notification.notification_id);
        assert.equal(saved.result.notification.contact_direction, null);
        assert.equal((await rows("select count(*)::integer as n from public.notifications where lead_id=3"))[0].n, 1);
        await actor(a);
    });
    await test("invalid enum, result, missing direction and future time are rejected", async () => {
        for (const bad of [{ channel: "fax" }, { outcome: "no_answer" }, { direction: null }, { occurred: "2999-01-01T00:00:00Z" }, { follow: "2025-01-01T00:00:00Z" }, { notes: "x".repeat(10001) }]) {
            await rejected(() => record({ request: request(7), ...bad }), "22023");
        }
        await rejected(() => db.query("insert into public.notifications(lead_id,date,contact_direction) values(2,now(),'inbound')"), "23514");
    });
    await test("failed task insertion rolls back notification and summary", async () => {
        await db.exec("reset role");
        await db.exec(`create function public.reject_test_task() returns trigger language plpgsql as $$begin raise exception 'Synthetic task failure'; end$$;
            create trigger reject_test_task before insert on public.tasks for each row execute function public.reject_test_task();`);
        await actor(a);
        const [before] = await rows("select * from public.leads where lead_id=2");
        await rejected(() => record({ request: request(8), occurred: "2026-03-01T15:00:00Z", follow: "2026-03-02T15:00:00Z", version: before.version }), "P0001");
        assert.deepEqual((await rows("select * from public.leads where lead_id=2"))[0], before);
        assert.equal((await rows("select * from public.notifications where contact_request_id=$1", [request(8)])).length, 0);
        await db.exec("reset role; drop trigger reject_test_task on public.tasks; drop function public.reject_test_task()");
        await actor(a);
    });
    await test("closed lead accepts history but rejects new follow-up", async () => {
        await db.query("update public.leads set stage='CLOSED',status=false where lead_id=2");
        const [{ version }] = await rows("select version from public.leads where lead_id=2");
        await rejected(() => record({ request: request(9), version }), "22023");
        await record({ request: request(9), version, follow: null });
    });
    await test("transactional lead delete removes history/tasks and writes tombstones", async () => {
        await db.query("select public.autotrack_delete_lead(2)");
        assert.equal((await rows("select * from public.notifications where lead_id=2")).length, 0);
        assert.equal((await rows("select * from public.tasks where lead_id=2")).length, 0);
        assert.ok((await rows("select * from public.sync_deleted where entity='notifications'")).length >= 4);
    });
    console.log(`Contact history database checks: ${passed} passed (embedded PostgreSQL; real SQL/RLS, simulated auth.uid).`);
} finally { await db.close(); }
