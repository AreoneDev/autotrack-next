# Customer recovery and CSV export

Branch `codex/data-recovery-export`, based on `origin/main` (`7843dc8`).

## Integration dependency

Apply existing ownership/security migrations, then the additive
`supabase/migrations/20261107020000_lead_recovery_export.sql` migration, then
integrate the deletion client from **codex/lead-delete-integrity**. That branch
owns `LeadRepo.deleteLead` switching to one `autotrack_delete_lead(p_lead_id)` RPC.
This branch preserves that RPC signature, security-invoker/RLS behavior and
`Lead not found.` errors. It supplies the migration, recovery UI and export.

Until the deletion client is integrated, the old direct-table delete remains
permanent. Only transactional deletions after the recovery migration capture
snapshots. Old tombstones do not contain deleted customer data; older deletions
require an administrator database backup. Publish the `/data` UI after installing
the migration. No hosted migrations or real data changes were performed here.
The migration itself creates storage/functions/policies without deleting or
rewriting existing customer rows. Historical migrations remain unchanged.

## Recovery

The delete transaction locks the owned lead and child rows, snapshots raw lead,
tasks, notifications and both vehicle-link tables before deleting any child,
then deletes children and lead. Invalid cross-account historical relationships
fail closed. Vehicle entities and sync tombstones are retained.

Snapshot rows are RLS isolated and read-only to users. The narrow capture helper
accepts only an owned ID, never supplied JSON, and cannot delete anything. A
captured snapshot for an active lead is hidden. Restore checks ownership, locks
the snapshot, preserves IDs, sync IDs, raw nulls/dates/notes, completed tasks and
all links, and advances revisions beyond saved rows and deletion tombstones.
It does not trigger application task regeneration or scoring. Existing vehicle
details stay current. A missing/unavailable vehicle, conflicting primary key,
constraint failure or unsupported schema rolls back the entire restoration;
existing data is never overwritten. Lost-response retries do not duplicate rows. Restore returns text IDs and the
recycle-bin query selects IDs as text, preserving legacy bigint precision.
Completed deletion/restoration cycles retain snapshots and tombstones. Future
sync consumers must compare revisions instead of treating any old tombstone as
permanent absence. There is no automatic snapshot expiry or purge in this release.

Format version 1 uses raw JSON and current table composite types. Future schema
changes adding generated/required columns must update restore compatibility
before activation. Unhandled constraints fail closed with the snapshot retained.
The tests use the repository's reconstructed historical schema, not a live dump.

## CSV

Customer data is accessible from the sidebar. Export uses one owner-filtered,
RLS-enforced SQL statement and a consistent MVCC snapshot. A JSON scalar avoids
the PostgREST table-row cap and pagination races. It includes all owned leads,
tasks and notifications (including history, completed and owned orphan rows),
visible vehicle links, owned/referenced visible vehicles, recovery snapshots and
sync tombstones. Unreferenced shared catalogue rows are excluded.

UTF-8 BOM, quoted cells, escaped quotes and CRLF support spreadsheet viewing.
`record_type` identifies the table; original IDs preserve joins. Columns are the
sorted union of raw fields. JSON numbers are converted to exact decimal text in
PostgreSQL before browser parsing, including nested snapshots, so large IDs and
legacy numeric amounts are not rounded by JavaScript. Nested recovery JSON is a quoted cell. Metadata rows
preserve version/time even for empty accounts. Formula-leading values (including
whitespace/control prefixes) receive an apostrophe. Preserve the original CSV:
spreadsheets may treat that prefix differently. CSV cannot distinguish SQL null
from an empty string, is not a database backup, and has no import/restore flow.

Any failed/malformed RPC prevents download. Account/auth changes invalidate
pending results and downloads; customer data is not stored in localStorage.
Export assembles data in memory: very large accounts can exceed server/browser
limits and require administrator backup until a streamed export is implemented.
A failed export does not intentionally produce a partial file.

## Verification

`npm run test:data-recovery` uses development-only PGlite (real PostgreSQL in
memory), synthetic users and rows only. It does not load .env, database URLs,
existing databases or hosted accounts. Covers RLS/anonymous isolation, raw legacy
fields/nulls/Unicode/completed history, 2,000-task export, missing vehicle, child
ID conflict, late insert failure rollback, repeated cycles, retry idempotency,
tombstone retention and invalid old cross-account children.

Focused Jest suites: `tests/unit/csv.test.ts`,
`tests/unit/CustomerDataRepo.test.ts`, `tests/ui/CustomerDataPage.test.tsx` cover
formula safety, quoting, complete/failing RPC, recycle-bin paging, restore
confirmation/retry, text escaping and account-switch download cancellation.
Also run full Jest, typecheck, lint and production build.

For shared worktree dependencies, `AUTOTRACK_TEST_PGLITE_MODULE` may point to an
independently installed PGlite `dist/index.js`. PGlite tests do not replace local
Supabase HTTP/Auth tests or staging verification of the actual production
schema. The delete-integrity task also verifies its deletion tests against this
migration before release. No merge or deployment is performed by this task.

Build verification used `next build --webpack` with synthetic loopback Supabase
configuration and completed successfully, including `/data`. The default
Turbopack build could not resolve the cross-drive shared `node_modules` junction.
Only Next.js and `.bin` were copied into this worktree to verify the webpack
build; no project configuration or shared source was changed for the workaround.
No Docker engine is available here, so a local Supabase HTTP/Auth run remains a
release/staging check. SQL policies, functions and transactions were exercised in
PGlite, and cross-checked with the deletion task's independent SQL verification.

Final verification: 35 Jest suites / 319 tests passed; 21 focused CSV/repository/UI
tests passed; typecheck, full-project ESLint, PGlite recovery/export verification
and webpack production build passed. No real customer data was used or changed.
