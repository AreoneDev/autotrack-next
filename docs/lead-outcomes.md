# Lead outcome consistency

## Previous conflict

- The detail editor saved `CLOSED` with `status=false`, displayed as Lost.
- Analytics treated both `CLOSED` and `DELIVERED` as successful deals, including those Lost records.
- The boolean status control could not represent delivered or closed outcomes.
- Scoring previously ignored `status=false`, allowing Lost records with an open stage to receive priority and automatic follow-ups.
- Analytics can reuse a stale stored score for an inactive lead and count it as hot.

The database has a free-text stage and a boolean status, with no explicit outcome or closure timestamp. Existing records alone cannot establish whether a generic `CLOSED` record was won or lost.

## Confirmed business rule

The user confirmed on November 7, 2026 that generic `CLOSED` means an unconfirmed outcome. It must not be inferred as a sale or a loss.

| Existing record | Effective outcome | Active follow-up | Counts as a deal |
| --- | --- | --- | --- |
| Stage `DELIVERED`, either status | Delivered | No | Yes |
| Stage `CLOSED`, either status | Closed, outcome unconfirmed | No | No |
| Other stage, `status=false` | Lost | No | No |
| Other stage, `status=true` | Active | Yes | No |

`getLeadOutcome` in `domain/objects/LeadOutcome.ts` normalizes case and surrounding whitespace when interpreting stage values. Stored legacy values remain intact on read. Explicit `DELIVERED` takes precedence over a conflicting legacy boolean. There is no bulk update or data migration.

The deal conversion metric remains delivered leads divided by all leads, including Lost and unconfirmed closures. Its monthly trend remains a cohort metric grouped by lead creation month, since the data has no delivery date. Both facts are stated in the metric descriptions.

One domain outcome resolver supplies labels, filters, scoring, agenda generation, dashboard recommendations and analytics. Delivered is available in stage editors; Closed is available in stage filters. Delivered and Closed display distinct statuses. The priority level `CLOSED` remains an internal marker for exclusion from active follow-up, covering every non-active outcome, and displays as Inactive in lead details.

When explicitly saving a lead, the real repository normalizes its stage and writes `status=false` and score zero for all non-active outcomes. Reads never issue a repair write. New terminal leads also start inactive.

Terminal row status controls are read-only; the lead detail page provides stage editing. To confirm a closure as a sale, choose `DELIVERED`. To reopen a terminal lead, choose an open stage; status becomes Active in the draft. To classify it as Lost, choose an open stage and then select Lost before saving. Editing the stage of an already Lost open lead preserves Lost. Failed saves retain the draft; failed table status saves restore status and score.

Existing manually created tasks and historical activities remain visible and are not deleted or completed automatically. Only automatic lead recommendations and new automatic follow-ups stop for terminal or Lost leads.

## Validation

The decision-table tests cover conflicting legacy booleans, lowercase and whitespace, domain active/closed checks, score and hot-lead exclusion, automatic agenda generation, conversion ratios and monthly trends. Repository contract tests verify that reads preserve legacy values and explicit writes normalize them. Component tests cover outcome and stage filters, terminal controls and creation. Browser tests use synthetic local data for legacy read compatibility, retained manual tasks, cross-page metrics, delivery confirmation, failed-save retry, reload, reopening and loss.

No dependency or database schema changes are required.

Verified on November 7, 2026: 33 Jest suites / 324 tests pass, with the final affected scoring/outcome/component suites rechecked (76 tests). TypeScript, full ESLint and whitespace checks pass. The production Webpack build and 26 desktop/mobile Chromium journeys pass against loopback synthetic data. A temporary local runner extended startup timeout and selected `next build --webpack`; it was removed after validation. Default Turbopack was blocked by dependency junctions outside this worktree's filesystem root, so its build remains for a normal dependency installation / CI environment. Firefox and WebKit were not run locally for this change.
