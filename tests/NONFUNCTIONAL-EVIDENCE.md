# Verification record

Baseline: origin/main d82ddfd09c3a0971eb9496a84556b0f2b1797f71 (PR #2).
Work performed in a separate managed worktree on codex/nonfunctional-assurance.
All accounts and data used by new tests are synthetic.

Initial local findings:
- Locked dependencies: 45 affected packages (2 critical, 8 high, 32 moderate, 3 low).
- The 1,000-lead performance case remained in "Loading leads..." after its
  5-second readiness timeout. Inspection found two relationship requests per
  lead, about 2,000 additional requests.
- Fixed by 200-ID PostgREST FK-embedding batches, with per-association vehicle
  mapping so trim overrides cannot mutate another lead's vehicle.

Dependency remediation:
- Updated the lockfile within declared ranges, patched brace-expansion, and
  aligned Next.js and eslint-config-next at 16.4.4.
- Rechecked installed Next.js testing/production guides before further changes.
- Final production audit: 0 advisories.
- Complete graph: 0 critical, 0 high, 32 moderate, 3 low. These residual findings
  are in the development-tool graph. Raw audit includes individual paths and
  advisory URLs. No forced downgrade or incompatible transitive override was used.
- The automated threshold is high/critical; remaining lower severities are a
  known limitation and prevent treating this as an issue-free automatic merge.

Local checks:
- TypeScript and ESLint passed after corrections.
- Jest: 31 suites, 296 tests passed; lines 66.16%, branches 59.95% globally.
  New hydration adapter: 100% lines, 94.11% branches. Coverage is not a claim of
  security or requirements completeness.
- Windows managed-worktree path required the documented Jest --testMatch
  override. Canonical Linux CI results are recorded separately.
- Local production-build NFR: all 5 cases passed. 1,000 leads loaded in 2,276.7 ms; filtering 639.1 ms; TTFB 19.4 ms; exactly 10 association requests. 360 HTTP samples had zero failures; phase p95 values 10.4/39.4/62.4/8.7 ms (last is recovery).
- Verified source revision: 2224b86a9217f48abe36146634b8f9bb190af9e9.
- [Canonical CI run](https://github.com/AreoneDev/autotrack-next/actions/runs/41576115701):
  lint/typecheck passed, 31 suites / 296 Jest tests passed, production build and
  52 E2E cases passed across Chromium, Firefox, WebKit and mobile Chromium.
- [Nonfunctional CI run](https://github.com/AreoneDev/autotrack-next/actions/runs/41576115725):
  all three jobs passed. Linux browser: 5 cases passed; 1,000 leads loaded in
  1,342.1 ms, filtering 341.7 ms, TTFB 6.6 ms, exactly 10 association queries.
  HTTP phase p95: 6.7/22.6/30.0/5.9 ms; all 360 responses correct, zero failures.
- Real isolated recovery: PostgreSQL 17.11; backup 103.1 ms; restore plus data,
  schema and behavior verification 609.8 ms (budget 60,000 ms). Snapshot-relative
  RPO zero; post-backup row absent; truncated archive rejected; container removed.
  Schema/content/sequence comparison and restored RLS/grants/revision/delete
  behavior all passed.
- CI dependency audit: production 0; all dependencies 0 high/critical,
  32 moderate / 3 low. Committed Linux lock SHA-256:
  eec53f82fc1e1f1341f51296146a1f662af13bd2a064427491d31cf51efa1092.
- Retained raw reports:
  [browser](https://github.com/AreoneDev/autotrack-next/actions/runs/41576115725/artifacts/13203563241),
  [audit](https://github.com/AreoneDev/autotrack-next/actions/runs/41576115725/artifacts/13203752344),
  [recovery](https://github.com/AreoneDev/autotrack-next/actions/runs/41576115725/artifacts/13203013584).
  Artifacts expire after 14 days; job logs and this summary retain the key results.

Environment limitations:
- Local Docker/PostgreSQL tooling is unavailable. The recovery evidence above
  comes from the dedicated disposable Linux CI Docker job.
- C: disk filled during an initial install. Only this task's generated
  node_modules/.next were removed/rebuilt; npm download cache moved to
  D:/codex-nfr-cache. No other checkout's files or branches were changed.
- No production data, actual login, destructive production test or production
  load was used.

Merge/deployment:
- [PR #4](https://github.com/AreoneDev/autotrack-next/pull/4) is open and unmerged.
- Do not automatically merge while known dependency issues remain. Root remaining
  advisories involve minimatch (GHSA-g3hv-75wg-m249), glob (GHSA-3g3m-2fjr-6pw4)
  and deepmerge (GHSA-gcqx-w48m-w2h4), propagated through the development tools.
  Remediation needs a reviewed toolchain upgrade; incompatible overrides and the
  force-audit downgrade suggestions were not applied.
- A deployment cannot be claimed from a passing build alone; verify a deployment
  associated with the actual merged commit if this PR is later approved to merge.

Follow-up reliability correction:
- The documentation-only follow-up run at 686ee1a exposed a container startup
  race in recovery: pg_isready observed the image's temporary Unix-socket-only
  initdb server, which then stopped before psql connected. Cleanup still passed.
- The runner now probes TCP 127.0.0.1 inside the network-isolated container.
  The temporary initdb server has TCP disabled, so readiness waits for the final
  PostgreSQL server without opening a host port. This is a test-harness fix.
- Final-head check results are linked from PR #4; the successful measured run
  above is retained with its exact source revision rather than overwritten.
