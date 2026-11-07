# Disposable Supabase integration and security tests

Run `npm ci`, install Docker with a running **local** engine, and install Supabase CLI **2.75.0** on PATH. Then run:

```sh
npm run test:supabase
```

The runner fails rather than skips when prerequisites, migrations or assertions fail. CI installs the pinned CLI and runs the same command in a separate job with no project secrets. This suite uses real Postgres, Auth password login, PostgREST and Supabase clients. Default Jest and browser tests still use doubles.

## Isolation and lifecycle

The runner creates a random project ID in a fresh OS temporary directory; it does not read the repository's Supabase config, linked-project metadata, `.env` files or hosted credentials. It strips inherited Supabase/PG/database environment variables, refuses Docker host/context overrides and rejects nonlocal Docker endpoints. Ports 56420–56429 are reserved for this suite. A collision fails startup; no existing database is reset.

The runner uses `docker exec` only on its newly named database container. It bootstraps the test-only legacy schema, applies **every checked-in migration byte-for-byte in order**, checks SQL metadata/preservation, then runs HTTP tests. In a finally block it stops its project with `--no-backup` and removes its temporary directory, also after partial startup or failed assertions. Forced process termination can interrupt cleanup; CI's ephemeral runner provides the final boundary. Local recovery: identify only the `autotrack-security-<id>` containers from that run before removing them; never run a broad Docker prune.

Two synthetic `example.invalid` users are created and confirmed through the local Admin API, then sign in independently with passwords. The service-role client only creates those users; application reads/writes use their normal JWTs or the anon client. No real login, hosted project or outbound email is involved.

## Legacy schema limitation

The repository starts with an ownership alteration migration and has no original CREATE TABLE history. `legacy-schema.sql` is a **test fixture reconstructed from repository contracts**, not a verified snapshot of any deployed database. It includes foreign keys, seven pre-ownership rows and deliberately permissive policies to verify backfill, preservation and policy replacement. It must never be deployed.

The historical migration requires one fixed email lookup. The fixture supplies an inert auth row with a synthetic UUID and that lookup value extracted from the migration, with no password, identity or session. It neither authenticates nor contacts the address. Actual test actors always use `example.invalid`. Production migrations and the historic project-specific verification SQL are not modified; the latter's hardcoded data counts make it unsuitable for this disposable fixture.

## ISTQB risk and decision-table coverage

| Risk / partition or transition | Evidence |
| --- | --- |
| Legacy ownership, row counts, backups, old allow-all policies | `migration-checks.sql` |
| RLS enabled, anonymous CRUD revoked, authenticated TRUNCATE/REFERENCES/TRIGGER revoked, backups inaccessible | `migration-checks.sql` |
| Self vs other, both directions, read/update/delete; forged owner insert | RLS-01/02 |
| Immutable owner/sync ID; insert → update → delete, revision and tombstone | RLS-03 |
| Own child with own/foreign/null parent | RLS-04 |
| Link to own/shared/foreign vehicle and own/foreign lead; forbidden mutations leave data unchanged | RLS-05 |
| Shared catalogue read-only, private vehicle cannot be made shared | RLS-06 |
| Imported catalogue and own deletion history read-only | RLS-07 |
| Anonymous CRUD on all eight tables; malformed JWT | RLS-08, AUTH-LIVE-01 |
| Six real adapters: CRUD, mapping, associations and separate clients | DB-LIVE-01/03 |
| Foreign/anonymous RPC denial; own atomic delete and history | DB-LIVE-02 |

Negative tests assert SQL error codes or zero affected rows **and** reread protected fixtures where applicable. This avoids mistaking a successful HTTP response containing no rows for a successful unauthorized write. No skipped cases or credential-dependent fallbacks are used. Machine-readable results are saved to `test-results/supabase-results.json` and uploaded by CI.

This proves behavior for the reconstructed schema and pinned local stack. It does not prove deployed schema parity, production configuration, email delivery/callbacks, backup restoration, load or exhaustive authorization coverage. Never configure this command to point at a hosted database.

CLI lifecycle references: [local development](https://supabase.com/docs/guides/local-development/cli/getting-started) and [CLI reference](https://supabase.com/docs/reference/cli/introduction).


## Customer deletion integrity

`delete-integrity.sql` runs after migration metadata checks, inside a transaction
that always rolls back its synthetic fixtures. It audits the delete RPC's
invoker mode, fixed search path and authenticated-only execution. It verifies
foreign/missing targets, signed-out calls, repeated deletes, multiple dependent
tasks, notifications, both vehicle associations, standalone/unrelated rows,
vehicle preservation and deletion history. An injected notification trigger
fails after earlier child deletes and checks exact row rollback, including
`sync_deleted` and recovery snapshots when the recovery migration is installed.
A deliberately corrupt cross-account child must cause an atomic rejection.

The HTTP suite's DB-LIVE-02 calls `LeadRepo.deleteLead` with dependent rows, so
it catches accidental regressions back to direct table deletes. The browser
HTTP double only models the RPC interface and UI outcomes; it does not establish
SQL transaction or authorization correctness.

The client requires `autotrack_delete_lead(bigint)` from
`20261025160000_per_user_data_access.sql`. Missing RPC/schema cache errors report
that the database migration is required and never fall back to direct deletes.
Invalid, fractional or unsafe numeric IDs are rejected before any RPC call;
the current domain uses JavaScript numbers and cannot safely delete bigint IDs
above `Number.MAX_SAFE_INTEGER` until ID handling is migrated end to end.
The historical function permanently deletes the customer's rows while retaining
sync tombstones and all vehicle entities. Recoverable deletion additionally
requires the coordinated `codex/data-recovery-export` migration
`20261107020000_lead_recovery_export.sql`, installed **before** enabling this
client. The coordinated branch checkpoint is `aef49cf`; that branch owns
snapshot capture and restoration. Existing tombstones
alone cannot reconstruct previously deleted content.

For deployment review, run `supabase/verification/20261107_lead_delete_preflight.sql`
with a read-only database administrator connection on a staging schema cloned
from the target. It reports incoming foreign keys, expected columns, execution
privileges and function settings without reading customer values or changing
data. Review unexpected incoming constraints/triggers against the full delete
transaction. This repository's original schema is reconstructed, so fixture
success cannot establish parity with a deployed schema. The full local Auth /
PostgREST suite remains `npm run test:supabase` (Docker + Supabase CLI 2.75.0).

Local branch validation on 2026-11-07 additionally executed the SQL integrity
suite both with the historical migrations and with the coordinated recovery
migration on PostgreSQL 18.6 via disposable in-memory PGlite 0.5.15; that is real
PostgreSQL SQL/RLS/trigger execution with a synthetic `auth.uid()` fixture. It
does not exercise the Supabase gateway, Auth, pg_safeupdate extension or the
deployed schema. No hosted database was contacted.

Function privilege guidance: [Supabase database functions](https://supabase.com/docs/guides/database/functions).


Final application checks: 96 repository integration tests, 53 UI tests,
TypeScript and ESLint passed. Both Chromium customer journeys passed against a
production webpack build, including dependent-delete failure/retry and reload.
Local validation used an uncommitted Playwright configuration with dedicated
loopback ports and webpack because dependencies were linked across drives.
Product build and Playwright configuration were not changed.
