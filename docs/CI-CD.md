# Selective CI and production release gates

CI validates code. Vercel builds/deploys independently and only promotes a production
deployment when GitHub reports **Production CI** successful for that deployment's
commit. CI never waits for a Vercel deployment, uses production credentials, runs
hosted migrations, or changes customer data.

## Selection policy

| Changed paths | Required suites |
| --- | --- |
| Root README/AGENTS/CLAUDE/DevLog, docs/, Storyboard/, tests/**/*.md | Planner/gate self-tests only |
| app/, components/, public/ | Lint + types + all Jest/coverage + production build; all four E2E projects/accessibility; NFR browser/security/performance/load |
| tests/unit/, tests/integration/, tests/ui/ | Lint + types + all Jest/coverage + production build (browser journeys skipped) |
| tests/e2e/ (including its shared fixtures) | Code checks, E2E journeys and NFR browser |
| tests/supabase/ | Disposable Supabase migrations/Auth/repositories/RLS |
| tests/recovery/, tests/data-recovery/ | PostgreSQL backup/restore, PGlite recovery/export, Supabase (shared bootstrap SQL) |
| tests/nonfunctional/dependency-audit.mjs | Production and development dependency audit |
| Other tests/nonfunctional/ | NFR browser |
| lib/, domain/, proxy, SQL/Supabase, dependencies/lockfile, CI, shared fixtures/configuration, unknown paths | All six suites |

Selection is deliberately by suite, not a heuristic per individual test: this app
has cross-page and shared repository contracts. New/unclassified paths default to
full regression. Mixed changes use the union. Adding a narrower category requires
updating planner tests. The recovery job now also includes test:data-recovery,
which was absent from the previous workflows.

## Event ranges and status semantics

- PR: merge-base of event base SHA and head SHA to head SHA. Full history is fetched;
  execution still tests GitHub's checked-out merge commit, incorporating current main.
- Main push: event before..after, including every commit in a multi-commit push.
- Merge queue: merge_group base_sha..head_sha.
- Renames are compared as delete+add; both old and new paths count. Git uses NUL-delimited
  names, so whitespace/newlines/Unicode do not split filenames.
- Initial push, missing/unreachable history, manual dispatch and unknown events use all
  suites. Use Actions → CI → Run workflow for full regression on any chosen ref.
- There are no workflow-level path filters. Planning and aggregate gate always run.
  The aggregate requires successful planning, an exact tested SHA, valid boolean flags,
  success for selected jobs, and success/skipped only for unaffected jobs. Missing,
  failed, cancelled, neutral or unexpected skipped required jobs fail closed.
- A workflow cancelled before its aggregate can finish may leave a cancelled/missing
  check. This blocks release; there is no claim that cancellation can always emit
  a completed aggregate. PR supersession cancels stale runs; main pushes are not
  cancelled by newer commits.
- **PR CI** is for PR/merge-group validation. **Production CI** is for push-SHA
  validation. **Full regression CI** is manual. Names are unique; a manual run or
  PR merge-ref check cannot stand in for the production push check.
- The rollout branch codex/selective-ci-release-gate also emits Production CI on
  push so the real check can be registered before merging. After rollout its
  trigger can be removed in a normal full-regression PR.

## Gate rollout without a protection gap

1. Validate this branch and obtain successful PR CI and push Production CI.
   CI changes themselves always trigger all six suites, including all five old checks.
2. Add PR CI (GitHub Actions as source) to main protection **alongside** the five
   existing checks. Enable up-to-date branches; preserve required PRs/admin enforcement,
   disabled force pushes/deletions, and do not require Vercel deployment success.
3. Add Production CI to Vercel's production-only Deployment Checks **alongside**
   the five old checks. Verify it is saved and automatic production aliasing is enabled.
4. The new gate is now mandatory before the selective workflow reaches main.
   Keep old checks through the first main-push validation and inspect the exact
   production deployment SHA, Actions run and domain promotion.
5. Only after that proof may old individual requirements be removed, while the
   aggregate remains required. Retaining old checks during rollout is intentional.

Do not force-promote a waiting deployment, fabricate statuses, temporarily disable
protection, or require Production CI before merging a PR (it belongs to main push).
If the aggregate fails, inspect its upstream jobs and rerun the failed eligible
workflow; manual Full regression CI cannot substitute for the production gate.

## Local verification

    node --test ci/ci.test.mjs
    npm run lint
    npm run typecheck
    npm run test:coverage
    npm run test:e2e
    npm run test:nfr
    npm run test:dependencies
    npm run test:supabase
    npm run test:recovery
    npm run test:data-recovery

Supabase and backup tests use disposable local Docker resources. Browser tests use
synthetic loopback fixtures, not hosted data. The planner needs only Node and Git.

References: [GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
[Vercel Deployment Checks](https://vercel.com/docs/deployment-checks).
