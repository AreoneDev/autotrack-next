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
- Dedicated Linux CI recovery and canonical existing E2E results: pending.

Environment limitations:
- Local Docker/PostgreSQL tooling is unavailable. Actual recovery must execute
  in the dedicated disposable Linux CI Docker job before it is called verified.
- C: disk filled during an initial install. Only this task's generated
  node_modules/.next were removed/rebuilt; npm download cache moved to
  D:/codex-nfr-cache. No other checkout's files or branches were changed.
- No production data, actual login, destructive production test or production
  load was used.

Merge/deployment:
- Do not automatically merge while known dependency issues remain.
- A deployment cannot be claimed from a passing build alone; verify a deployment
  associated with the actual merged commit if this PR is later approved to merge.
