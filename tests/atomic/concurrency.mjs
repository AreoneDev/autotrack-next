import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Explicit local binaries only; never accepts a database URL or existing data dir.
const bin = process.argv[2];
if (!bin) throw new Error("Pass the directory containing initdb and pg_ctl (PostgreSQL 17+).");
const executable = name => join(resolve(bin), name + (process.platform === "win32" ? ".exe" : ""));
const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "autotrack-atomic-")));
const dataDir = join(scratch, "data");
const env = { ...process.env };
for (const key of Object.keys(env)) {
    if (/^(PG|DATABASE_URL$|SUPABASE_|NEXT_PUBLIC_SUPABASE_)/i.test(key)) {
        delete env[key];
        delete process.env[key]; // pg runs in this process; binaries use env above.
    }
}
function run(name, args, timeout = 30000) {
    // pg_ctl's Windows server child can retain inherited pipe handles after
    // startup; the server writes its own log instead of holding this call open.
    const result = spawnSync(executable(name), args, { env, encoding: "utf8", windowsHide: true, timeout,
        stdio: name === "pg_ctl" ? "ignore" : "pipe" });
    if (result.error || result.status !== 0) throw new Error(name + ": " + (result.error?.message ?? result.stderr ?? result.status) + "\n" + (result.stdout ?? ""));
}
const reserve = createServer();
await new Promise((resolve, reject) => { reserve.once("error", reject); reserve.listen(0, "127.0.0.1", resolve); });
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const clients = [];
let started = false;
const a = "11111111-1111-4111-8111-111111111111";
async function client() {
    const db = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "", database: "postgres", ssl: false,
        connectionTimeoutMillis: 10000, statement_timeout: 10000 });
    await db.connect(); clients.push(db); return db;
}
const selection = name => ({ year: "2026", make: "Synthetic", model: "Catalogue", trim: name });
async function save(db, id, request, name, version = 1) {
    return (await db.query("select public.autotrack_save_lead_details($1,$2,$3,$4,$5,$6) as result",
        [id, version, request, { first_name: name }, selection(name), selection(name)])).rows[0].result;
}
try {
    run("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--no-sync", "-E", "UTF8"], 120000);
    started = true; // Also stop a partially successful start.
    run("pg_ctl", ["-D", dataDir, "-l", join(scratch, "postgres.log"), "-w", "-t", "20",
        "-o", `-h 127.0.0.1 -p ${port} -F -c max_connections=10`, "start"]);
    const admin = await client();
    console.log((await admin.query("select version() as version")).rows[0].version);
    await admin.query(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
      $$; grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;`);
    const email = read("supabase/migrations/20261025160000_per_user_data_access.sql").match(/lower\('([^']+)'\)/)?.[1];
    assert.match(email, /^[a-zA-Z0-9@._+-]+$/);
    await admin.query(read("tests/supabase/legacy-schema.sql").replace(":'legacy_owner_email'", "'" + email + "'"));
    for (const name of readdirSync(new URL("supabase/migrations/", root)).filter(n => n.endsWith(".sql")).sort()) {
        await admin.query(read("supabase/migrations/" + name));
    }
    await admin.query("grant usage,select on all sequences in schema public to authenticated");
    await admin.query("insert into auth.users values($1,'concurrency@example.invalid')", [a]);
    const editors = await Promise.all([client(), client()]);
    for (const editor of editors) {
        await editor.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: a })]);
        await editor.query("set role authenticated");
    }
    // An admin-held row lock forces both requests to wait at the same time,
    // proving overlap instead of relying on scheduler timing.
    async function race(sameRequest) {
        const id = (await admin.query("insert into public.leads(first_name,owner_id) values('Before',$1) returning lead_id", [a])).rows[0].lead_id;
        await admin.query("begin");
        await admin.query("select lead_id from public.leads where lead_id=$1 for update", [id]);
        const request = randomUUID();
        const replies = editors.map((editor, index) => save(editor, id, sameRequest ? request : randomUUID(), sameRequest ? "Retry" : "Editor " + index)
            .then(value => ({ value }), error => ({ error })));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            await admin.query("select pg_stat_clear_snapshot()");
            const count = (await admin.query("select count(*)::int as n from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [editors.map(e => e.processID)])).rows[0].n;
            if (count === 2) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        await admin.query("commit");
        const results = await Promise.all(replies);
        assert.equal(blocked, true, "Both separate connections must contend on the locked lead");
        const row = (await admin.query("select * from public.leads where lead_id=$1", [id])).rows[0];
        assert.equal(Number(row.version), 2);
        if (sameRequest) {
            assert.equal(results.filter(r => r.value).length, 2);
            assert.deepEqual(results[0].value, results[1].value);
        } else {
            assert.equal(results.filter(r => r.value).length, 1);
            assert.equal(results.find(r => r.error)?.error.code, "40001");
        }
        for (const table of ["lead_vehicle_interests", "lead_trade_in_vehicles"]) {
            const link = (await admin.query(`select * from public.${table} where lead_id=$1`, [id])).rows[0];
            assert.equal(link.trim_override, row.first_name);
            assert.equal(Number(link.vehicle_id), 1);
        }
        assert.equal((await admin.query("select count(*)::int as n from public.lead_save_requests where lead_id=$1", [id])).rows[0].n, 1);
        if (sameRequest) {
            // A late retry must never revert a later successful edit.
            await save(editors[0], id, randomUUID(), "Later", 2);
            assert.deepEqual(await save(editors[1], id, request, "Retry"), results[0].value);
            const current = (await admin.query("select first_name,version from public.leads where lead_id=$1", [id])).rows[0];
            assert.equal(current.first_name, "Later"); assert.equal(Number(current.version), 3);
        }
        console.log("PASS " + (sameRequest ? "overlapping duplicate calls, lost-response replay, and late replay" : "overlapping editors: one complete winner, one stale conflict"));
    }
    await race(false);
    await race(true);
} finally {
    await Promise.allSettled(clients.map(db => db.end()));
    if (started) run("pg_ctl", ["-D", dataDir, "-w", "-t", "20", "-m", "immediate", "stop"]);
    // Check the absolute target before removing this runner's fresh scratch dir.
    const tempRoot = realpathSync(tmpdir());
    if (!scratch.startsWith(tempRoot + sep) || !scratch.slice(tempRoot.length + 1).startsWith("autotrack-atomic-")) {
        throw new Error("Refusing to remove unexpected scratch path.");
    }
    rmSync(scratch, { recursive: true, force: true });
}
