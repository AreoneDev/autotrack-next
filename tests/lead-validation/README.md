# Lead validation and duplicate review

Branch: codex/lead-dedup-validation, based on origin/main (7843dc8).

## Behavior

- Email is optional. New or edited values are trimmed and lowercased; dots and plus tags are preserved. Nonempty values need an email address with a dotted domain.
- Phone is optional. Canadian/US 10-digit numbers (or 11 digits starting with 1) become +1 numbers. International numbers require + or 00 and 8–15 digits. Punctuation is removed; extensions are rejected with an explanation.
- Budget is optional (blank means 0), finite, non-negative, within JavaScript's safe integer range, and accepts up to two decimal places. Raw text is validated before conversion, so junk, exponent notation and negative values cannot silently become 0.
- Invalid changed fields block saving with accessible inline errors. Unchanged historical invalid fields do not block unrelated edits. Reading records never normalizes or validates them.
- Matches are advisory. Review links open existing customers in another tab; Create Anyway / Save Anyway confirms the displayed record IDs. Editing the draft clears confirmation. Inactive customers are included and the edited customer is excluded.
- Existing duplicates do not prevent unrelated edits or formatting cleanup. A changed contact identity is checked against canonical keys from historical rows in the same account.
- Failed requests retain the draft and allow retry. In-flight saves prevent additional submissions and freeze inputs.

## Persistence and rollout dependency

Apply supabase/migrations/20261107120000_lead_contact_validation.sql **before** releasing the application code. The migration notifies PostgREST to reload its schema cache. No hosted migration or data change was performed during this task.

The migration creates normalization helpers, a BEFORE INSERT/UPDATE trigger, non-unique lookup indexes, and the SECURITY INVOKER save_lead_validated RPC. RLS and generated identity/sync defaults remain authoritative. Owner/sync identity/revision supplied in JSON cannot override database ownership metadata.

No historical rows are rewritten, deleted, merged, or validated; no unique constraint is added. Index creation takes normal PostgreSQL index-build locks; schedule appropriately for a large live table.

Saves acquire a transaction advisory lock per account. The VOLATILE trigger checks for duplicates after acquiring that lock under READ COMMITTED. Concurrent creates/edits cannot silently pass the same preflight check. Confirmation covers the displayed IDs only; a newly committed duplicate causes another prompt. Direct table writes also pass through the trigger. Contact-changing transactions at stronger isolation receive a retry error instead of relying on a stale snapshot. A direct update using a conflicting lock order may receive PostgreSQL's normal deadlock/retry error.

This task does not add optimistic concurrency/version checking for unrelated fields. Existing independent lead/vehicle saves are retained. When integrating the parallel atomic lead/vehicle save branch, retain this trigger and carry duplicate IDs into the combined transaction; do not replace the validated save entry point with an unguarded table write.

## Automated checks

~~~powershell
npm run typecheck
npm test -- --runInBand --testTimeout=15000
$env:E2E_APP_PORT='3367'
$env:E2E_BACKEND_PORT='54467'
npx playwright test lead-validation.spec.ts leads.spec.ts lead-detail.spec.ts --project=chromium
~~~

The browser backend is an HTTP contract double. Database checks below use a real disposable PostgreSQL process and do not claim to test real Supabase Auth/PostgREST. The existing npm run test:supabase runner remains available when Docker and Supabase CLI are installed.

Install test tooling outside the source tree on a drive with enough free space:

~~~powershell
$tools = 'D:\autotrack-lead-validation-runtime\postgres-tools'
npm install --prefix $tools --no-save --ignore-scripts @embedded-postgres/windows-x64@18.6.0-beta.19 pg@8.16.3
$env:AUTOTRACK_PG_TOOLS=$tools
$env:TEMP='D:\autotrack-lead-validation-runtime'
$env:TMP=$env:TEMP
node tests/lead-validation/postgres.mjs
~~~

Use the matching @embedded-postgres platform package for Linux/macOS. No production dependency is added. The runner selects a loopback port and creates a fresh scratch cluster, applies historical migrations, exercises RLS as two users, and stops/removes only its own cluster. It never reads .env files or accepts hosted database URLs.

The 13 database checks cover migration preservation/reapplication, normalization, invalid/blank values, legacy edits, historical duplicates/confirmation/self exclusion, owner isolation, changed-identity edits, simultaneous creates, stale confirmation, simultaneous edits, direct writes, confirmation alongside unchanged historical fields, and the fresh snapshot after a verified lock wait.

References: [function snapshots](https://www.postgresql.org/docs/18/xfunc-volatility.html), [transaction advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html).
