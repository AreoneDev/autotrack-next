# Lead outcome consistency: proposal for review

## Observed conflict

- The detail editor saves `CLOSED` with `status=false`, displayed as Lost.
- Analytics treats both `CLOSED` and `DELIVERED` as successful deals, including those Lost records.
- The boolean status control cannot represent delivered or closed outcomes.
- Scoring previously ignored `status=false`, allowing Lost records with an open stage to receive priority and automatic follow-ups.
- Analytics can reuse a stale stored score for an inactive lead and count it as hot.

The database has a free-text stage and a boolean status, with no explicit outcome or closure timestamp. Existing records alone cannot establish whether a generic `CLOSED` record was won or lost.

## Recommended business rule (awaiting confirmation)

| Existing record | Effective outcome | Active follow-up | Counts as a deal |
| --- | --- | --- | --- |
| Stage `DELIVERED`, either status | Delivered | No | Yes |
| Stage `CLOSED`, either status | Closed, outcome unconfirmed | No | No |
| Other stage, `status=false` | Lost | No | No |
| Other stage, `status=true` | Active | Yes | No |

Normalize case and surrounding whitespace when interpreting stage values. Preserve stored legacy values on read; do not run a bulk update or infer delivery from a generic closure. Explicit `DELIVERED` takes precedence over a conflicting legacy boolean.

The deal conversion metric remains delivered leads divided by all leads, including Lost and unconfirmed closures. Its monthly trend remains a cohort metric grouped by lead creation month, since the data has no delivery date. Make both facts clear in the metric descriptions.

Use one domain outcome resolver for labels, filters, scoring, agenda generation, dashboard recommendations and analytics. Offer Delivered in stage editors and Closed in stage filters. Show Delivered and Closed as distinct statuses instead of displaying them as Active or Lost. Changing an outcome must save a consistent stage/status pair; reopening a terminal lead must explicitly choose an active stage. Closed records need an explicit delivery/loss decision before reclassification.

Existing manually created tasks and historical activities remain visible and are not deleted or completed automatically. Only automatic lead recommendations and new automatic follow-ups stop for terminal or Lost leads.

## Decision required

Confirm whether generic historical `CLOSED` means an unconfirmed closure (recommended), always Lost, or always Delivered. There is no reliable data-only backfill between those interpretations.

After confirmation, implement the resolver and editors, replace the contradictory analytics expectation, and add a cross-layer decision table covering conflicting legacy booleans, lowercase/whitespace, reopening, failed writes, reload, filters, scores and trends. Use synthetic test data only; no hosted data migration is required by this proposal.

## Independent corrections implemented

Lost records now receive zero calculated score and no automatic follow-ups or priority recommendations. Inactive and terminal leads no longer qualify as hot through stale stored scores. These corrections do not determine the disputed business meaning of `CLOSED`.

Validation: all 32 Jest suites / 301 tests pass; TypeScript (`--noEmit --incremental false`), ESLint for the changed TypeScript files and `git diff --check` pass. No dependency or database schema changes. Browser outcome/reload coverage remains part of the work after the business decision; the conflicting `CLOSED` conversion behavior is intentionally still pending that decision.
