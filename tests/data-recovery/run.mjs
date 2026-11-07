import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// No .env, network, database URL, hosted service, or existing database is read.
// A module override lets a worktree reuse a separately installed test-only engine.
const { PGlite } = await import(process.env.AUTOTRACK_TEST_PGLITE_MODULE
    ? pathToFileURL(process.env.AUTOTRACK_TEST_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = name => readFileSync(path.join(root, name), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async sql => Object.values((await query(sql))[0])[0];
const fail = async (sql, pattern) => {
    await assert.rejects(() => db.exec(sql), pattern);
};
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const as = async owner => {
    await db.exec('reset role;');
    await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: owner })]);
    await db.exec('set role authenticated;');
};
try {
    await db.exec(file('tests/recovery/bootstrap.sql'));
    await db.exec(file('supabase/migrations/20261025160000_per_user_data_access.sql')
        .replace("lower('pengyuwang777@gmail.com')", "lower('owner-a@example.test')"));
    await db.exec(file('supabase/migrations/20261031010000_restrict_extra_table_privileges.sql'));
    await db.exec(file('supabase/migrations/20261107020000_lead_recovery_export.sql'));
    await db.exec(`insert into public.vehicles(make,model,year,owner_id) values('Private','Trade',1999,'${ownerA}');
        insert into public.lead_trade_in_vehicles(lead_id,vehicle_id) values(1,2);
        update public.tasks set completed=true, completed_at='2020-01-01T12:00:00Z', notes=null where task_id=1;`);
    const before = await scalar("select to_jsonb(l) from public.leads l where lead_id=1");
    const tasksBefore = await query('select * from public.tasks where lead_id=1 order by task_id');
    const notificationsBefore = await query('select * from public.notifications where lead_id=1 order by notification_id');
    await as(ownerA);
    assert.deepEqual(await scalar(`select public.autotrack_export_safe_json('{"id":9007199254740993,"budget":1234567890.123456789,"nested":[-9007199254740994]}'::jsonb)`),
        { id: '9007199254740993', budget: '1234567890.123456789', nested: ['-9007199254740994'] });
    const exported = await scalar('select public.autotrack_export_data()');
    assert.equal(exported.leads.length, 1000);
    assert.equal(exported.tasks.length, 2000); // Proves no REST table cap.
    assert.equal(exported.leads[0].notes, before.notes);
    await db.exec('select public.autotrack_delete_lead(1)');
    const archive = (await query('select * from public.lead_recovery_snapshots'))[0];
    assert.deepEqual(archive.snapshot.lead, before);
    assert.equal(archive.snapshot.tasks.length, 2);
    assert.equal(await scalar('select count(*)::int from public.leads where lead_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from public.vehicles'), 2);
    assert.equal(await scalar("select count(*)::int from public.sync_deleted where entity='tasks'"), 2);
    assert.equal(await scalar("select has_table_privilege('authenticated','public.lead_recovery_snapshots','INSERT')"), false);
    assert.equal(await scalar("select has_table_privilege('authenticated','public.lead_recovery_snapshots','UPDATE')"), false);

    await as(ownerB);
    assert.equal(await scalar('select count(*)::int from public.lead_recovery_snapshots'), 0);
    const foreignExport = await scalar('select public.autotrack_export_data()');
    for (const table of ['leads','tasks','notifications','vehicles','recovery_snapshots','sync_deleted','lead_vehicle_interests','lead_trade_in_vehicles']) {
        assert.deepEqual(foreignExport[table], []);
    }
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /Recovery snapshot not found/);
    await fail('select public.autotrack_delete_lead(2)', /Lead not found/);
    await db.exec('reset role; set role anon;');
    await fail('select public.autotrack_export_data()', /permission denied/);
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /permission denied/);
    await fail('select * from public.lead_recovery_snapshots', /permission denied/);
    await as(null); // Missing uid must fail even if caller role is authenticated.
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /Sign in required/);
    await as(ownerA);

    // Removed related entity: restoration is all-or-nothing.
    await db.exec('delete from public.vehicles where vehicle_id=2');
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /linked vehicle is missing/);
    assert.equal(await scalar('select count(*)::int from public.leads where lead_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from public.lead_recovery_snapshots where restored_at is null'), 1);
    await db.exec(`insert into public.vehicles(vehicle_id,make,model,year,owner_id) values(2,'Private','Trade',1999,'${ownerA}')`);

    // Child primary key conflict: even an already inserted parent must roll back.
    await db.exec(`insert into public.tasks(task_id,lead_id,title) values(1,2,'Conflicting task')`);
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /duplicate key/);
    assert.equal(await scalar('select count(*)::int from public.leads where lead_id=1'), 0);
    await db.exec('delete from public.tasks where task_id=1');

    // Inject a late failure and prove all earlier inserts and archive updates roll back.
    await db.exec(`reset role;
      create function public.test_recovery_fail() returns trigger language plpgsql as $$begin
        if new.lead_id=1 then raise exception 'synthetic restore failure'; end if; return new; end$$;
      create trigger test_recovery_fail before insert on public.notifications for each row execute function public.test_recovery_fail();`);
    await as(ownerA);
    await fail(`select public.autotrack_restore_lead('${archive.recovery_id}')`, /synthetic restore failure/);
    assert.equal(await scalar('select count(*)::int from public.leads where lead_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from public.tasks where lead_id=1'), 0);
    assert.equal(await scalar('select count(*)::int from public.lead_recovery_snapshots where restored_at is null'), 1);
    await db.exec('reset role; drop trigger test_recovery_fail on public.notifications;');
    await as(ownerA);
    const restored = await scalar(`select public.autotrack_restore_lead('${archive.recovery_id}')`);
    assert.equal(restored, "1");
    assert.equal(await scalar(`select public.autotrack_restore_lead('${archive.recovery_id}')`), '1'); // Idempotent retry.
    const after = await scalar('select to_jsonb(l) from public.leads l where lead_id=1');
    assert.ok(after.version > before.version + 1);
    for (const key of Object.keys(before).filter(k => !['version','updated_at'].includes(k))) assert.deepEqual(after[key], before[key], key);
    const tasksAfter = await query('select * from public.tasks where lead_id=1 order by task_id');
    assert.equal(tasksAfter.length, tasksBefore.length);
    for (let i=0; i<tasksBefore.length; i++) {
        assert.ok(tasksAfter[i].version > tasksBefore[i].version + 1);
        for (const key of Object.keys(tasksBefore[i]).filter(k => !['version','updated_at'].includes(k))) {
            assert.deepEqual(tasksAfter[i][key], tasksBefore[i][key], key);
        }
    }
    const notificationsAfter = await query('select * from public.notifications where lead_id=1 order by notification_id');
    assert.equal(notificationsAfter.length, notificationsBefore.length);
    for (let i=0; i<notificationsBefore.length; i++) {
        for (const key of Object.keys(notificationsBefore[i]).filter(k => !['version','updated_at'].includes(k))) {
            assert.deepEqual(notificationsAfter[i][key], notificationsBefore[i][key], key);
        }
    }
    assert.equal(await scalar("select count(*)::int from public.sync_deleted where entity='leads'"), 1); // History retained.
    assert.equal(await scalar('select count(*)::int from public.lead_vehicle_interests where lead_id=1'), 1);
    assert.equal(await scalar('select count(*)::int from public.lead_trade_in_vehicles where lead_id=1'), 1);
    await db.exec('select public.autotrack_delete_lead(1)');
    assert.equal(await scalar('select count(*)::int from public.lead_recovery_snapshots'), 2); // Previous cycle retained.

    // Invalid historical cross-account child must prevent capture and deletion.
    await db.exec(`reset role; insert into public.notifications(lead_id,title,owner_id) values(2,'Bad legacy relationship','${ownerB}')`);
    await as(ownerA);
    await fail('select public.autotrack_delete_lead(2)', /Inconsistent customer relationships/);
    assert.equal(await scalar('select count(*)::int from public.leads where lead_id=2'), 1);
    assert.equal(await scalar('select count(*)::int from public.lead_recovery_snapshots where lead_id=2'), 0);
    await db.exec(`insert into public.leads(lead_id,first_name) values(9007199254740993,'Large legacy ID')`);
    await db.exec('select public.autotrack_delete_lead(9007199254740993)');
    const largeRecovery = await scalar('select recovery_id from public.lead_recovery_snapshots where lead_id=9007199254740993');
    assert.equal(await scalar(`select public.autotrack_restore_lead('${largeRecovery}')`), '9007199254740993');
    const exactExport = await scalar('select public.autotrack_export_data()');
    assert.equal(exactExport.leads.find(row => row.first_name === 'Large legacy ID').lead_id, '9007199254740993');
    console.log('PASS: owner/anonymous isolation, legacy/null/Unicode preservation, 2,000-row export, transactional delete and restore, missing vehicle, child ID conflict, late rollback, idempotent retry, repeated cycles and retained tombstones.');
} finally { await db.close(); }
