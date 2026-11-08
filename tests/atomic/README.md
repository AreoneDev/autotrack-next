# Atomic lead detail saving

The detail editor previously wrote `leads`, then vehicle interest, then trade-in
in three HTTP calls. The original Chromium journeys reproduced a persisted name
change after either association failed. Those journeys now assert that the whole
database state remains unchanged.

`LeadRepo.saveLeadDetails` calls `autotrack_save_lead_details` once. The function
runs as `SECURITY INVOKER` with an empty search path and the caller's existing RLS
policies. It locks the owned lead, checks its loaded `version`, resolves both
vehicles from the caller-visible catalogue, writes all three records, and stores
a request receipt in the same transaction. Any SQL exception rolls back all of
those writes, including the revision trigger and receipt. There is no client
compensation sequence or nontransactional fallback.

The editor freezes the request ID and entire payload for an unchanged draft,
including clock-derived dates and score. It preserves the draft on errors. A
changed draft receives a new request ID. A committed request can be replayed after
a lost response without another write, even after a later edit. Different payloads
cannot reuse that ID. Two editors with the same expected version cannot both
commit; the losing editor must reload and reconcile its draft.

Receipts are scoped to the authenticated owner, immutable to clients, and removed
with their parent lead. They contain the saved payload and original response.
No timed pruning is introduced; a retention window can be chosen separately.
The legacy single-entity repository methods remain available; callers saving the
three-part aggregate must use the new method.

## Database compatibility and release dependency

The additive migration is
`supabase/migrations/20261107010000_atomic_lead_details.sql`. It requires the
existing ownership/version migration and the current association schema with
`lead_id` unique, `vehicle_id`, `trim_override`, and `updated_at` columns. Existing
leads, association rows, ownership policies, shared/private catalogue rows and
custom trim overrides are preserved. Matching is literal and case-insensitive;
exact trims are preferred, otherwise the lowest matching vehicle ID supplies the
catalogue reference and the custom trim is stored as an override.

Review/apply the new migration before releasing the application. This change does
not apply it to any hosted database. If the RPC or loaded version is absent, the
UI fails before separate writes and displays migration guidance. The checked-in
legacy schema is reconstructed from repository contracts, not a deployed schema
dump; deployed schema parity must be reviewed before any release. Do not deploy
the test bootstrap or rerun historical ownership backfills as part of this fix.

## Verification

```sh
npm run test:atomic-db
npm test -- --runInBand
npm run typecheck
npm run lint
npm run test:e2e -- tests/e2e/lead-detail.spec.ts --project=chromium
```

`test:atomic-db` uses in-memory PostgreSQL through the development dependency
`@electric-sql/pglite`. It applies every migration unchanged, checks RLS metadata,
and uses synthetic JWT claims under the actual non-superuser `authenticated` and
`anon` PostgreSQL roles. Its checks cover legacy preservation, custom trims,
idempotent replay, payload mismatch, invalid vehicles, stale versions, immutable
fields, foreign leads/private vehicles, anonymous denial, and atomic clearing.
Test-only triggers inject failures during the last association's INSERT and DELETE;
full row/association/version/receipt snapshots must remain equal before retry.
It does not simulate Supabase Auth or multiple simultaneous database connections.
CI runs this check in addition to Jest and browser journeys.

For real overlapping connections without Docker, provide a local PostgreSQL 17+
binary directory containing `initdb` and `pg_ctl`:

```sh
npm run test:atomic-concurrency -- /absolute/path/to/postgres/bin
```

This runner uses the development dependency `pg`. It creates a fresh temporary
cluster on a free loopback port, strips inherited PG/database/Supabase settings,
and never accepts a database URL or an existing data directory. It holds a row
lock until `pg_stat_activity` confirms both independent clients are blocked, then
releases them and checks the complete winning aggregate. It also tests concurrent
duplicate requests and replay after a later edit. Clients run as `authenticated`
with synthetic claims; the setup/lock barrier uses only this temporary cluster's
administrator. The cluster is stopped and its verified scratch directory removed
in `finally`. No system service is installed. Forced process termination can
interrupt cleanup.

For the actual Supabase HTTP/Auth/PostgREST boundary, run `npm run test:supabase`
with the prerequisites in [the Supabase test guide](../supabase/README.md).
`atomic.live.ts` tests concurrent editors, duplicate requests and delayed replay.
That runner applies the same migration and executes the existing RLS suite.

Local evidence on 2026-11-07: the original two partial-write reproductions passed;
the fixed five Chromium detail journeys passed; all 33 Jest suites / 303 tests,
typecheck and lint passed. Nine in-memory SQL checks and both forced-overlap
PostgreSQL 17.11 concurrency cases passed. The complete Supabase stack could not
run locally because Docker is absent; its HTTP tests remain for CI. All data used
was synthetic. No production database, merge, deployment or hosted write was used.

References: [Supabase database functions](https://supabase.com/docs/guides/database/functions),
[PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html).
