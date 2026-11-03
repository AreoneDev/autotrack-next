# Test strategy and traceability

The test design follows the techniques in the [ISTQB CTFL syllabus v4.0.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf): equivalence partitioning, boundary value analysis, decision tables, state transitions, and risk-based prioritization. It does not claim formal certification or exhaustive coverage. Case IDs in test names link to the risk areas below; existing tests predate these IDs.

| Risk / expected behavior | Design | Cases / level |
| --- | --- | --- |
| Scoring, follow-up cadence, closed leads and DST | Boundary values, terminal states | SC; `tests/unit/business/ScoringBoundaries.test.ts` |
| Analytics denominators, budget, scores, communication and trends | Partitions, boundaries, decision table | AN; `tests/unit/business/AnalyticsService.test.ts` |
| Activity classification, order and relative time | Partitions, time boundaries | RA; `tests/unit/business/RecentActivityService.test.ts` |
| Vehicle required fields, clear, save and catalog lookup | Decision table, partitions | VS; `tests/unit/business/VehicleSelectionService.test.ts` |
| Repository mapping, paging, errors, deduplication and relationships | Boundaries, failure injection, service/repository integration | DB; `tests/integration/persistence/real/` (scripted HTTP client doubles) |
| Authentication callback, session protection, login and logout | Decision table and transitions | AUTH-CB, UI-AUTH, UI-GATE, UI-ACCOUNT, E2E-AUTH |
| Lead search, filtering, creation, status rollback and deletion | Partitions, boundaries, transitions | UI-LEAD, E2E-LEAD |
| Task completion and vehicle form | Transitions, negative cases | UI-TASK, UI-VEH |
| Calendar month lengths, leap years, six-week months | Boundaries | UI-CAL |
| Lead-detail cancel, failed write/retry, edited fields after reload, CLOSED → inactive status and missing lead navigation | Transitions, failure injection, partitions | E2E-DETAIL-01, E2E-DETAIL-03; `tests/e2e/lead-detail.spec.ts` |
| Communication write failure/retry, exactly one notification across detail/dashboard/agenda | Transitions, cross-page persistence | E2E-DETAIL-02 |
| Follow-up required type/title, create/edit/complete/reopen/delete, failure recovery and late-evening local dates | Decision table, transitions, date boundary | E2E-TASK-01; `tests/e2e/follow-up-tasks.spec.ts` |
| Dashboard today/past/future and completed partitions, active/closed priority counts, completion failure/retry | Partitions, transitions, cross-page persistence | E2E-DASH-01; `tests/e2e/dashboard-agenda.spec.ts` |
| Agenda lead/type validation, case-insensitive search, create failure/retry, selected dates and refresh/reload | Decision table, partitions, transitions | E2E-AGENDA-01 |
| Agenda overdue completion failure/retry, complete/reopen across reload and dashboard overdue metric | Transitions, cross-page persistence | E2E-AGENDA-02 |
| Empty dashboard and empty selected agenda date | Empty partition | E2E-DASH-02 |

Fixtures contain synthetic data. Unit, integration and React tests are deterministic and never require Supabase credentials. `tests/integration/persistence/real/` exercises real adapter code with a scripted client double: it does not execute SQL or prove row-level security. Playwright builds the application against a loopback-only, resettable HTTP double on ports 3100 and 54329. Do not reuse those ports for a real service during the run. The double implements only the paths needed by these tests; it is not a Supabase emulator. Browser tests run serially so their resets do not race. The suite covers Chromium, Firefox, WebKit and a mobile Chromium viewport.

Business journeys seed synthetic rows through the double's `/__test__/reset`, inspect persisted rows through `/__test__/state`, and inject one failed POST/PATCH/DELETE through `/__test__/fail-next`. These endpoints exist only in the test fixture process, never in the application. Failed writes are rejected before mutation; browser assertions check the visible error, preserved draft/state, successful retry, and reload where applicable. Dates are derived in America/Toronto; the task journey saves at 23:45 and reopens the edit form after reload to detect accidental UTC day shifts. These checks cover HTTP-double persistence for the lifetime of the fixture, not durable storage across backend restarts or transactional guarantees across multiple writes.

```sh
npm ci
npm run test:unit
npm run test:integration
npm run test:ui
npm run test:coverage
npx playwright install chromium firefox webkit
npm run test:e2e
npm run typecheck
npm run lint
```

Coverage reports are in `coverage/`; the denominator deliberately includes untested components and production repositories so gaps remain visible. Playwright HTML reports and failed traces/screenshots are in `playwright-report/` and `test-results/`. Coverage measures execution, not the adequacy of assertions. Case IDs label test intent, not requirements approved by a product owner.

The separate [disposable Supabase suite](supabase/README.md) runs unmodified migrations and real two-user Auth, repository and RLS checks via `npm run test:supabase`. Its baseline is reconstructed from repository contracts, so it does not establish deployed schema parity. CI runs it as its own required-candidate check with no hosted secrets.

Remaining high-priority work: verify deployed schema parity and real email callbacks; cover vehicle-association partial failures and real database transactions; add keyboard/screen-reader accessibility, performance/load, security and backup/recovery tests. No current test should be interpreted as evidence of production RLS enforcement.
