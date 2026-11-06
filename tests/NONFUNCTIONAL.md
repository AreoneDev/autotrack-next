# Nonfunctional test strategy and evidence

This suite extends the ISTQB-style risk inventory in [TESTING.md](TESTING.md).
Case IDs describe risk-based tests, not certification or exhaustive security coverage.

| Risk / oracle | Design technique | Cases |
| --- | --- | --- |
| Large lead lists exhaust connections | Boundary values 0, 1, 199, 200, 201, 1,000; query-count oracle | PERF-DB-01 |
| Batched joins mix per-lead trims or expose unavailable vehicles | Equivalence partitions and failure injection | PERF-DB-02/03 |
| Batched embedding disagrees with real PostgREST / relationship RLS | Two authenticated users, shared catalogue, independent overrides | DB-LIVE-04 in tests/supabase/security.live.ts |
| Session gate bypass or cached private redirect | Decision table: five private paths × ordinary/spoofed/malformed-cookie request | SEC-HTTP-01 |
| Callback redirects to attacker; old mutation pages accessible | Negative partitions | SEC-HTTP-02 |
| Stored HTML executes in lead names | Persist → render state transition, text/DOM/execution oracles | SEC-XSS-01 |
| Large list or filter becomes unusable | Fixed synthetic population and elapsed-time budgets | PERF-UI-01 |
| Concurrent HTTP traffic returns wrong content or fails recovery | Step workload and recovery transition, status/content/cache oracles | LOAD-HTTP-01 |
| Known vulnerable direct/transitive dependencies | Production and complete dependency graph; fail closed on missing/invalid audit | SEC-DEP-01 |
| Backup silently loses rows, sequences or policy definitions | Full ordered row + sequence comparison and normalized schema comparison | REC-01 |
| Restored DB loses access isolation or behavior | Role decision table and insert/update/delete state transitions | REC-SEC |
| Corrupt archive is accepted | Negative archive partition | REC-02 |

## Reproduce

Use Node.js 24 and the committed lockfile:

~~~sh
npm ci
npx playwright install --with-deps chromium
npm run test:nfr
npm run test:dependencies
# Requires a running local Docker engine, not a database URL:
docker pull postgres:17
npm run test:recovery
~~~

The three jobs in [.github/workflows/nonfunctional.yml](../.github/workflows/nonfunctional.yml)
also run on PRs and main pushes. Artifacts retain raw evidence for 14 days:
`nonfunctional-browser`, `dependency-audit`, and `recovery-evidence`.
They are evidence snapshots; npm advisories and the postgres:17 image can change.
Reports record PostgreSQL version, migration/archive/content hashes, and audit timestamp/lock hash.
No database dumps are uploaded.

Run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, and
`npm run test:e2e` for the existing regression suite as well. The Jest globs inherited from main support Windows managed worktrees. The separate [Supabase guide](supabase/README.md) documents CLI prerequisites for npm run test:supabase; that suite also verifies the new batch embedding against real PostgREST and two authenticated users.

## Targets, thresholds and isolation

- Browser/load targets are fixed to `127.0.0.1:3200` and the synthetic HTTP double
  at `127.0.0.1:54339`. The runner overrides public Supabase build variables,
  refuses existing listeners, and aborts browser requests outside these two origins.
  Do not share this checkout's build directory with a concurrently running build.
  Existing E2E retains its separate default ports 3100/54329.
- PERF-UI-01: 1,000 leads; full-list readiness <5,000 ms, single-result filtering
  <1,000 ms, document TTFB <1,500 ms, exactly 10 association queries.
  This measures a desktop Chromium loopback regression with an HTTP double.
  It does not measure field Core Web Vitals, mobile devices, internet latency,
  PostgREST SQL execution, or Supabase capacity.
- LOAD-HTTP-01: closed workload phases (concurrency, samples) =
  (1,30), (5,100), (10,200), (1,30). Total 360 requests, maximum 10 concurrent.
  Alternate login HTML and anonymous dashboard redirects. Every phase requires
  zero errors/wrong responses and nearest-rank p95 <2,000 ms; request timeout
  5,000 ms. p50, p95, max, throughput and recovery-phase results are reported.
  Throughput is descriptive, not a promised production capacity. No stress,
  soak, authenticated write, or production load is performed.
- SEC-DEP-01: zero high/critical advisories in both graphs. Network, timeout,
  invalid JSON and missing count metadata fail the gate. Lower-severity findings
  remain visible in raw reports; a green threshold does not mean zero vulnerabilities.
  The script does not apply fixes or suppress advisories.
- REC-01: Docker creates a uniquely named PostgreSQL 17 container with
  `--network none`, no host ports/bind mounts, synthetic users, and no imported
  credentials. Host `DATABASE_URL`, `PGHOST`, and Supabase values are never used.
  It creates separate source, restored, and corrupt-archive databases; only the
  generated container ID and its anonymous data volumes can be removed (docker rm -fv). Cleanup failure fails the run.
- Recovery fixture: 1,000 initial leads, 2,000 tasks, 1,000 notifications, Unicode,
  nulls, catalogue/relationship rows, a second owner and a deletion tombstone.
  The historical migration's selected-email literal is replaced only in memory
  with `owner-a@example.test`; committed migrations are not rewritten and the
  original bytes are hashed. This avoids creating or using the historical real login.
- Recovery oracle: `pg_dump -Fc` → fresh DB → `pg_restore --exit-on-error
  --single-transaction`; compare every fixture row in public/auth/backup schemas,
  sequence state, and schema definitions including RLS policies, grants, functions,
  triggers, indexes and constraints. Ignore only dump comments, blank lines and
  randomized psql restrict tokens in schema comparison.
  Replay role and revision/deletion checks before and after recovery.
  A committed post-backup row must be absent from recovery. A truncated archive
  must fail restoration into a third database.
- Fixture RTO: restore, fingerprint and security verification <60,000 ms.
  Fixture snapshot RPO: zero missing rows relative to the completed dump snapshot.
  Neither is an operational SLA or a PITR guarantee.

## Interpretation and operational gaps

The bootstrap is a minimal historical-schema contract needed to execute the
committed migrations; it is not an authoritative production schema export.
The test uses PostgreSQL roles and a claims-reading auth.uid() shim, not hosted
Supabase Auth, PostgREST, JWT validation, Storage or Realtime.
Cluster roles already exist in the isolated container: pg_dump does not back
them up. Storage objects, secrets, external auth providers, extensions beyond
this fixture, external integrations, backup encryption/retention, scheduled
off-site backup delivery, large-volume restore, and hosted PITR/failover remain
unverified. The separate [local Supabase suite](supabase/README.md) exercises real Auth/PostgREST/RLS against its reconstructed fixture. Deployed schema parity and real email callbacks remain unverified.

Reference behavior: [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), and
[npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/).
Use an approved off-site backup and a separate recovery environment for a real
operational runbook; this fixture is never a command to restore production.

## Verification record

See [NONFUNCTIONAL-EVIDENCE.md](NONFUNCTIONAL-EVIDENCE.md) for this change's
executed results, limitations and merge decision.
