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

Fixtures contain synthetic data. Unit, integration and React tests are deterministic and never require Supabase credentials. `tests/integration/persistence/real/` exercises real adapter code with a scripted client double: it does not execute SQL or prove row-level security. Playwright builds the application against a loopback-only, resettable HTTP double on ports 3100 and 54329. Do not reuse those ports for a real service during the run. The double implements only the paths needed by these tests; it is not a Supabase emulator. Browser tests run serially so their resets do not race. The suite covers Chromium, Firefox, WebKit and a mobile Chromium viewport.

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

The separate [disposable Supabase suite](supabase/README.md) runs unmodified migrations and real two-user Auth, repository and RLS checks via npm run test:supabase. Its baseline is reconstructed from repository contracts, so it does not establish deployed schema parity. CI runs it as its own required-candidate check with no hosted secrets.

Performance/load, security regression, dependency auditing and isolated backup/recovery are described in [NONFUNCTIONAL.md](NONFUNCTIONAL.md).

Remaining high-priority work: verify deployed schema parity and real email callbacks; add lead-detail editing, dashboard and agenda journeys; add keyboard/screen-reader accessibility and broader security coverage. No current test should be interpreted as evidence of production RLS enforcement.
