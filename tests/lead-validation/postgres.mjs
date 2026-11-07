// Uses only a fresh loopback database. No .env files or database URLs are read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.AUTOTRACK_PG_TOOLS) throw new Error("Set AUTOTRACK_PG_TOOLS; see tests/lead-validation/README.md.");
const tools = resolve(process.env.AUTOTRACK_PG_TOOLS);
const { Client, types } = createRequire(join(tools, "package.json"))("pg");
types.setTypeParser(20, Number); types.setTypeParser(1700, Number);
const platform = process.platform === "win32" ? "windows" : process.platform;
const bin = join(tools, "node_modules", "@embedded-postgres", platform + "-" + process.arch, "native", "bin");
const scratch = mkdtempSync(join(tmpdir(), "autotrack-lead-validation-"));
const data = join(scratch, "data");
const connections = [];
let started = false, checks = 0;
function run(name, args) {
    const log = join(scratch, name + ".log"), fd = openSync(log, "a");
    let result;
    try {
        result = spawnSync(join(bin, name + (process.platform === "win32" ? ".exe" : "")), args,
            { windowsHide: true, timeout: 90000, stdio: ["ignore", fd, fd] });
    } finally { closeSync(fd); }
    if (result.error || result.status !== 0) throw new Error((result.error?.message ?? "") + readFileSync(log, "utf8"));
}
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
async function connect(owner) {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
    await client.connect(); connections.push(client);
    if (owner) {
        await client.query("set role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: owner })]);
    }
    return client;
}
const draft = (extra = {}) => ({ first_name: "Synthetic", phone: "", lead_email: "", budget: 0,
    created_at: "2026-11-07T12:00:00Z", status: true, ...extra });
const save = async (db, row, ids = []) =>
    (await db.query("select * from public.save_lead_validated($1::jsonb, $2::bigint[])", [JSON.stringify(row), ids])).rows[0];
async function duplicates(request) {
    try { await request; assert.fail("Expected duplicate warning"); }
    catch (error) {
        assert.equal(error.message, "AUTOTRACK_DUPLICATE_LEAD");
        const matches = JSON.parse(error.detail); assert.ok(matches.length); return matches;
    }
}
const checked = label => { checks++; console.log("PASS " + label); };
try {
    run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8", "--no-sync"]);
    console.log("Initialized disposable PostgreSQL");
    // Do not pipe pg_ctl output: Windows server children can inherit pipe handles.
    started = true;
    run("pg_ctl", ["-D", data, "-l", join(scratch, "server.log"), "-o", "-h 127.0.0.1 -p " + port, "-w", "start"]);
    const admin = await connect();
    await admin.query("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid $$; grant usage on schema auth to authenticated, anon;");
    const dir = join(root, "supabase/migrations"), migrationName = "20261107120000_lead_contact_validation.sql";
    const ownership = readFileSync(join(dir, "20261025160000_per_user_data_access.sql"), "utf8");
    const legacyEmail = ownership.match(/lower\('([^']+)'\)/)[1];
    await admin.query(readFileSync(join(root, "tests/supabase/legacy-schema.sql"), "utf8")
        .replace(":'legacy_owner_email'", "'" + legacyEmail.replaceAll("'", "''") + "'"));
    for (const name of readdirSync(dir).filter(name => name.endsWith(".sql") && name !== migrationName).sort())
        await admin.query(readFileSync(join(dir, name), "utf8"));
    await admin.query("insert into auth.users values($1,'other@example.invalid')", [other]);
    await admin.query("insert into public.leads(owner_id,first_name,phone,lead_email,budget) values($1,'InvalidLegacy','extension 2','unknown',-7),($1,'LegacyOne','(416) 555-0199',' OLD@EXAMPLE.TEST ',100),($1,'LegacyTwo','416-555-0199','old@example.test',100)", [owner]);
    const before = (await admin.query("select * from public.leads order by lead_id")).rows;
    const migration = readFileSync(join(dir, migrationName), "utf8");
    await admin.query(migration); await admin.query(migration);
    assert.deepEqual((await admin.query("select * from public.leads order by lead_id")).rows, before);
    checked("migration/reapplication preserves all legacy rows and invalid/duplicate values");
    const a = await connect(owner), a2 = await connect(owner), b = await connect(other);
    const normalized = await save(a, draft({ phone: "(416) 555-0100", lead_email: " ADA+Cars@EXAMPLE.TEST ", budget: 42000.25 }));
    assert.equal(normalized.phone, "+14165550100"); assert.equal(normalized.lead_email, "ada+cars@example.test");
    assert.equal(normalized.budget, 42000.25);
    checked("contacts normalize and decimal budgets persist");
    for (const extra of [{ phone: "555" }, { phone: "4165550100 ext 2" }, { lead_email: "bad" },
        { budget: -1 }, { budget: "NaN" }, { budget: "Infinity" }, { budget: 12.345 }])
        await assert.rejects(save(a, draft(extra)), error => error.code === "22023");
    const blank = await save(a, draft({ phone: null, lead_email: null, budget: null }));
    assert.equal(blank.phone, ""); assert.equal(blank.lead_email, ""); assert.equal(blank.budget, 0);
    checked("invalid new contacts/budgets blocked; blank optional values accepted");
    const legacy = before.find(row => row.first_name === "InvalidLegacy");
    const updatedLegacy = await save(a, { ...legacy, notes: "Unrelated edit" });
    for (const key of ["phone", "lead_email", "budget"]) assert.equal(updatedLegacy[key], legacy[key]);
    await assert.rejects(save(a, { ...updatedLegacy, phone: "bad changed" }), error => error.code === "22023");
    checked("unchanged invalid legacy fields survive unrelated edits");
    const matches = await duplicates(save(a, draft({ phone: "+1 416 555 0199", lead_email: "old@example.test" })));
    assert.equal(matches.length, 2); assert.ok(matches.every(row => row.phone && row.email));
    const duplicate = await save(a, draft({ phone: "4165550199", lead_email: "old@example.test" }), matches.map(row => row.leadID));
    assert.equal((await save(a, { ...duplicate, notes: "Self" })).lead_id, duplicate.lead_id);
    checked("formatted legacy contacts match; confirmation and self exclusion work");
    assert.equal((await save(b, draft({ phone: "4165550199", lead_email: "old@example.test" }))).owner_id, other);
    await assert.rejects(save(b, { ...normalized, notes: "Hijack" }), /Lead not found/);
    const anon = await connect(); await anon.query("set role anon");
    await assert.rejects(save(anon, draft()), error => error.code === "42501");
    checked("account isolation and anonymous/cross-owner denials");
    const edited = await save(a, draft());
    assert.deepEqual((await duplicates(save(a, { ...edited, lead_email: normalized.lead_email }))).map(row => row.leadID), [normalized.lead_id]);
    await save(a, { ...edited, lead_email: normalized.lead_email }, [normalized.lead_id]);
    checked("edits require review for a changed contact identity");
    const results = await Promise.allSettled([save(a, draft({ lead_email: "parallel@example.test" })),
        save(a2, draft({ lead_email: " PARALLEL@EXAMPLE.TEST " }))]);
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
    assert.equal(results.find(row => row.status === "rejected").reason.message, "AUTOTRACK_DUPLICATE_LEAD");
    checked("simultaneous creates: one commit and one warning");
    const first = await save(a, draft({ lead_email: "fresh@example.test" }));
    const initial = await duplicates(save(a2, draft({ lead_email: "fresh@example.test" })));
    const second = await save(a, draft({ lead_email: "fresh@example.test" }), [first.lead_id]);
    assert.deepEqual((await duplicates(save(a2, draft({ lead_email: "fresh@example.test" }), initial.map(row => row.leadID))))
        .map(row => row.leadID), [first.lead_id, second.lead_id]);
    checked("new duplicates invalidate stale confirmations");
    const editA = await save(a, draft()), editB = await save(a2, draft());
    const edits = await Promise.allSettled([save(a, { ...editA, phone: "+442079460958" }),
        save(a2, { ...editB, phone: "0044 20 7946 0958" })]);
    assert.equal(edits.filter(row => row.status === "fulfilled").length, 1);
    assert.equal(edits.find(row => row.status === "rejected").reason.message, "AUTOTRACK_DUPLICATE_LEAD");
    checked("simultaneous edits: one commit and one warning");
    await duplicates(a.query("insert into public.leads(first_name,lead_email) values('Direct','parallel@example.test') returning *"));
    await assert.rejects(a.query("insert into public.leads(first_name,budget) values('Direct',-1)"), error => error.code === "22023");
    checked("direct table writes obey validation and duplicate guards");
    const legacyEmailMatches = await duplicates(save(a, { ...updatedLegacy, lead_email: normalized.lead_email }));
    const legacyEmailSaved = await save(a, { ...updatedLegacy, lead_email: normalized.lead_email }, legacyEmailMatches.map(row => row.leadID));
    assert.equal(legacyEmailSaved.phone, "extension 2");
    const legacyOne = before.find(row => row.first_name === "LegacyOne");
    const legacyPhoneMatches = await duplicates(save(a, { ...legacyOne, phone: normalized.phone }));
    const legacyPhoneSaved = await save(a, { ...legacyOne, phone: normalized.phone }, legacyPhoneMatches.map(row => row.leadID));
    assert.equal(legacyPhoneSaved.lead_email, " OLD@EXAMPLE.TEST ");
    checked("duplicate confirmation works with an unchanged invalid/formatted historical field");
    await a.query("begin");
    const held = await save(a, draft({ lead_email: "held@example.test" }));
    let settled = false;
    const pending = duplicates(save(a2, draft({ lead_email: "held@example.test" })).finally(() => { settled = true; }));
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        blocked = (await admin.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') as blocked", [a2.processID])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true); assert.equal(settled, false); await a.query("commit");
    assert.equal((await pending)[0].leadID, held.lead_id);
    checked("after a real lock wait, duplicate query sees the committed row");
    console.log("Completed " + checks + " PostgreSQL integration checks.");
} catch (error) { console.error(error); throw error; }
finally {
    for (const db of connections) { try { await db.query("rollback"); await db.end(); } catch {} }
    if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    if (dirname(scratch) !== tmpdir() || !scratch.startsWith(join(tmpdir(), "autotrack-lead-validation-"))) throw new Error("Unsafe scratch path");
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
