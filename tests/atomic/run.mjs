import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// No URLs, credentials, network, or persistent database. PostgreSQL SQL/RLS in
// WASM; multi-connection locking is tested separately in the live Supabase suite.
const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const vehicle = { year: "2026", make: "Synthetic", model: "Catalogue", trim: "Custom" };
let passed = 0;
let version = 1;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS " + name); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const actor = async id => {
    await db.exec("reset role");
    await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id })]);
    await db.exec("set role authenticated");
};
const save = (id, expected, request, details, interest = vehicle, tradeIn = vehicle, duplicates = []) => query(
    "select public.autotrack_save_lead_details($1,$2,$3,$4,$5,$6,$7) as result",
    [id, expected, request, details, interest, tradeIn, duplicates]
).then(rows => rows[0].result);
const snapshot = async id => (await query(`select jsonb_build_object(
    'lead', (select to_jsonb(l) from public.leads l where lead_id=$1),
    'interest', (select to_jsonb(i) from public.lead_vehicle_interests i where lead_id=$1),
    'trade_in', (select to_jsonb(t) from public.lead_trade_in_vehicles t where lead_id=$1),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by request_id), '[]') from public.lead_save_requests r where lead_id=$1)
  ) as state`, [id]))[0].state;
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
      $$; grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;`);
    const ownerMigration = read("supabase/migrations/20261025160000_per_user_data_access.sql");
    const legacyEmail = ownerMigration.match(/lower\('([^']+)'\)/)?.[1];
    assert.match(legacyEmail, /^[a-zA-Z0-9@._+-]+$/);
    await db.exec(read("tests/supabase/legacy-schema.sql").replace(":'legacy_owner_email'", "'" + legacyEmail + "'"));
    const migrationDir = fileURLToPath(new URL("supabase/migrations/", root));
    for (const name of readdirSync(migrationDir).filter(n => n.endsWith(".sql")).sort()) {
        await db.exec(read("supabase/migrations/" + name));
    }
    await db.exec(read("tests/supabase/migration-checks.sql"));
    await db.exec(`grant usage,select on all sequences in schema public to authenticated;
      insert into auth.users values ('${a}','a@example.invalid'),('${b}','b@example.invalid');
      insert into public.leads(first_name,owner_id) values ('Before','${a}'),('Foreign','${b}');
      insert into public.vehicles(make,model,year,trim,owner_id)
        values ('Private','Other',2026,'Base','${b}');`);
    await actor(a);
    const id = (await query("select lead_id from public.leads where first_name='Before'"))[0].lead_id;
    await test("migration preserves legacy rows and shared catalogue", async () => {
        await db.exec("reset role");
        assert.equal((await query("select count(*)::int as n from public.lead_vehicle_interests where lead_id=1"))[0].n, 1);
        assert.equal((await query("select count(*)::int as n from public.vehicles where owner_id is null"))[0].n, 1);
        await actor(a);
    });
    await test("aggregate save/custom trim; replay does not increment version", async () => {
        const request = randomUUID();
        const result = await save(id, version, request, { first_name: "Saved" });
        assert.deepEqual(result, { version: 2, vehicle_interest_id: 1, trade_in_vehicle_id: 1 });
        const state = await snapshot(id);
        assert.equal(state.interest.trim_override, "Custom");
        assert.equal(state.trade_in.trim_override, "Custom");
        assert.deepEqual(await save(id, version, request, { first_name: "Saved" }), result);
        assert.deepEqual(await snapshot(id), state);
        await rejects(save(id, 2, request, { first_name: "Changed payload" }), "22023");
        assert.deepEqual(await snapshot(id), state);
        version = 2;
    });
    await test("invalid second vehicle leaves all data and receipt unchanged", async () => {
        const state = await snapshot(id);
        await rejects(save(id, version, randomUUID(), { first_name: "Must roll back" }, null, { ...vehicle, model: "Missing" }), "22023");
        assert.deepEqual(await snapshot(id), state);
    });
    for (const operation of ["INSERT", "DELETE"]) {
        await test(`late ${operation} failure rolls back profile/interest/version; same request retries`, async () => {
            await db.exec(`reset role;
              create function public.atomic_test_fail() returns trigger language plpgsql as $$
              begin raise exception 'Injected late failure'; end $$;
              create trigger atomic_test_fail before ${operation} on public.lead_trade_in_vehicles
              for each row execute function public.atomic_test_fail();`);
            await actor(a);
            const state = await snapshot(id);
            const request = randomUUID();
            const selection = operation === "DELETE" ? null : vehicle;
            await rejects(save(id, version, request, { first_name: "Rollback" }, null, selection), "P0001");
            assert.deepEqual(await snapshot(id), state);
            await db.exec("reset role; drop trigger atomic_test_fail on public.lead_trade_in_vehicles; drop function public.atomic_test_fail()");
            await actor(a);
            const saved = await save(id, version, request, { first_name: "Rollback" }, null, selection);
            assert.equal(saved.version, ++version);
            const restored = await save(id, version, randomUUID(), { first_name: "Saved" });
            assert.equal(restored.version, ++version);
        });
    }
    await test("stale editor rejected; immutable metadata and empty names rejected", async () => {
        const state = await snapshot(id);
        await rejects(save(id, 1, randomUUID(), { first_name: "Stale" }), "PT409");
        for (const details of [{ owner_id: b }, { version: 999 }, { created_at: "2000-01-01" }, { first_name: "", last_name: "" }]) {
            await rejects(save(id, version, randomUUID(), details), "22023");
        }
        assert.deepEqual(await snapshot(id), state);
    });
    await test("duplicate contact confirmation is enforced within the atomic save", async () => {
        const other = (await query("insert into public.leads(first_name, lead_email) values('Duplicate', 'duplicate@example.test') returning lead_id"))[0].lead_id;
        const state = await snapshot(id);
        await rejects(save(id, version, randomUUID(), { lead_email: "duplicate@example.test" }), "P0001");
        assert.deepEqual(await snapshot(id), state);
        const result = await save(id, version, randomUUID(), { lead_email: "duplicate@example.test" }, vehicle, vehicle, [other]);
        assert.equal(result.version, ++version);
    });
    await test("foreign lead/catalogue rows rejected by RLS; receipts isolated", async () => {
        const state = await snapshot(id);
        await rejects(save(id, version, randomUUID(), { first_name: "Hidden vehicle" }, { year: "2026", make: "Private", model: "Other", trim: "" }), "22023");
        await actor(b);
        await rejects(save(id, version, randomUUID(), { first_name: "Hijacked" }), "P0002");
        assert.deepEqual(await query("select * from public.lead_save_requests"), []);
        await actor(a);
        assert.deepEqual(await snapshot(id), state);
    });
    await test("anonymous cannot execute saving or resolver", async () => {
        await db.exec("reset role; set role anon");
        await rejects(save(id, version, randomUUID(), { first_name: "Anonymous" }), "42501");
        await rejects(query("select public.autotrack_resolve_vehicle($1)", [vehicle]), "42501");
        await actor(a);
    });
    await test("explicit clear removes both associations atomically", async () => {
        const result = await save(id, version, randomUUID(), { notes: "Cleared" }, null, { year: "", make: "", model: "", trim: "" });
        assert.equal(result.version, ++version);
        const state = await snapshot(id);
        assert.equal(state.interest, null);
        assert.equal(state.trade_in, null);
    });
    console.log(`${passed} atomic database checks passed (in-memory PostgreSQL, synthetic RLS actors).`);
} finally {
    await db.close();
}
