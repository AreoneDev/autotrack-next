# Communication synchronization

Branch: `codex/contact-followup-link`, based on `origin/main` (`7843dc8`).

Call, Email and Message log outbound activity. `CommunicationRepo.logCommunication`
reads the latest lead, applies `USER` and the operation's exact timestamp, and
calculates the score with the existing `ScoringService`. It submits these to:

```sql
autotrack_log_communication(
  p_lead_id bigint,
  p_operation_id uuid,
  p_channel text,             -- call | email | message
  p_occurred_at timestamptz,
  p_expected_version bigint,
  p_score integer
) returns jsonb              -- { lead: full lead row, notification: full notification row }
```

Apply `20261107100000_log_communication.sql` after the existing ownership/sync
migrations before enabling this client. It uses security-invoker permissions and
RLS, locks the owned lead, checks its version, inserts the notification and updates
only contact metadata and score in one transaction. Missing RPCs and database
errors are surfaced without falling back to separate writes. Version conflicts
re-read and recalculate, with at most three attempts.

The operation UUID occupies the notification's existing `sync_id`. Replaying an
operation returns its saved notification and the current lead without writes,
even when the original version is stale. The tab keeps pending operations in
session storage until success, so a lost response followed by reload and retry
uses the same UUID and occurrence time. A separate deliberate click after success
is a new operation. Operations in other tabs use independent UUIDs. Older events
can be recorded without replacing newer contact metadata.

Score recency and silence milestones now use `lastInteractionDate ?? createdAt`
for both contact parties. The urgent-reply rule still requires `LEAD`. Timeline
deduplication uses title and calendar date, allowing the same milestone after a
later contact cycle, and urgent tasks keep the reply date across repeated views.
Existing tasks, their completion state, manual follow-up dates, lead stage and
notes are preserved. Logging an attempted outbound contact does not prove that
an inbound message was answered and does not complete tasks automatically.

The detail payload retains the full contact timestamp, including through ordinary
lead edits. Its display includes an explicit UTC time zone so server rendering and
browser hydration agree. The panel adopts refreshed server data because Next.js refresh keeps
client state mounted.

## Integration with the separate complete-contact-history branch

This branch adds no contact-history table or structured direction/outcome fields.
The other branch's planned `20261107130000_complete_contact_history.sql` sorts
after this migration. Its `autotrack_record_contact` RPC and
`notifications.contact_request_id` can coexist with this RPC and `sync_id`.

During integration, route the legacy Call/Email/Message buttons through the full
recording transaction if their new entries must populate structured contact
fields. Do not call both RPCs for the same activity: that would record two
notifications. Both paths must retain the same `LEAD`/`USER`, monotonic timestamp,
optimistic version and scoring rules. Legacy notifications have no reliable reply
association; unread/unreplied counts should use the complete model's explicit
inbound and reply data rather than notification titles or the latest outbound
contact. Both branches touch `LeadDetailPanel.tsx`; preserve this branch's retry
handling and exact timestamp mapping when resolving that overlap.

## Validation

`ContactFollowUp.test.ts` covers the shared recency baseline, repeated contact
cycles, preservation of existing tasks, urgent-task stability and DST calendar
days. `CommunicationRepo.test.ts` covers all channels, score calculation, version
conflicts, delayed events, read/write errors and missing migrations.

Lead-detail browser journeys cover failed writes, retry, a response lost after
commit followed by reload, channel persistence, unchanged manual fields and exact
timestamp preservation through subsequent editing. Their HTTP backend is a test
double, not a transaction or security emulator.

`tests/supabase/communication-checks.sql` exercises the real RPC and revision/RLS
rules, including an injected lead-update failure after notification insertion. It
rolls back all synthetic data and test-only triggers. The existing disposable
`npm run test:supabase` runner executes it after migrations. It must never run
against a hosted project. Local SQL validation can also run these same migrations
and assertions in an isolated in-memory PostgreSQL runtime; that does not replace
the HTTP/Auth suite. `CONTACT-LIVE-01` in the HTTP suite tests concurrent requests
for one operation against the disposable Supabase stack.

Verified locally: 216 business/adapter tests, six communication component tests,
seven Chromium lead-detail journeys, TypeScript, lint on changed TypeScript files,
and a complete Webpack production build. The same migration SQL and transactional
assertions passed in PGlite PostgreSQL, including applying the new migration twice.
The full disposable Supabase HTTP/Auth suite remains unrun locally because Docker
is unavailable; its concurrent HTTP case is included for that runner/CI.

Windows test setup used a local copy of the Next.js package and read-only package
junctions for other installed dependencies to avoid a full duplicate install on a
space-constrained system drive. Build with `npm run build -- --webpack` and
`CIRCLE_NODE_TOTAL=3` (two page-generation workers), then run the browser harness
against that completed build. Normal isolated installs can use the repository's
standard Playwright configuration. No build-configuration change is required by
the repair itself.
