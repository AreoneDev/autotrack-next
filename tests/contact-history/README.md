# Complete contact history

Branch: `codex/complete-contact-history`, based on `origin/main` at `7843dc8`.

Customer detail now contains a paginated contact timeline and a **Log contact** form. It records incoming/outgoing contact, channel, exact time, result, notes and an optional next follow-up. Recording a follow-up creates a normal, separately identifiable task in the same transaction. History is append-only in this interface. This is manual CRM entry; no mailbox, SMS or telephone provider is connected.

## Data and migration

Apply `supabase/migrations/20261107130000_complete_contact_history.sql` through the normal reviewed migration process before enabling writes. It extends the existing `notifications` table, preserving its ownership, revision tracking, deletion tombstones and lead relationship. It performs no history backfill and removes no existing records. Legacy notifications have null contact fields and are displayed with unknown direction/channel/result. A database that has not received this migration can still display old notifications; attempts to save new records report the migration requirement instead of performing a partial legacy insert.

New nullable fields: `contact_direction` (`inbound`/`outbound`), `contact_channel` (`call`/`email`/`message`/`in_person`/`other`), `contact_outcome` (`connected`/`no_answer`/`voicemail`/`sent`/`received`/`other`), `contact_notes`, `next_follow_up_at`, `contact_request_id`.

`autotrack_record_contact(p_lead_id, p_request_id, p_direction, p_channel, p_outcome, p_occurred_at, p_notes, p_next_follow_up_at, p_time_zone, p_expected_version, p_score)` is a SECURITY INVOKER transaction restricted to authenticated users and the owned lead. It locks the lead, verifies its version and atomically writes notification, recent-contact summary and optional follow-up. `ContactHistoryRepo` calculates the score from a fresh lead snapshot and retries version conflicts up to three times. Incoming contact sets `LEAD`; outgoing contact sets `USER`. Backdated records retain the newer summary and lead follow-up date. A closed lead permits history entry, but creating a new follow-up requires reopening it.

The owner/request unique key makes an unchanged form submission safe to retry after an uncertain HTTP result, including when the database committed but the response was lost. Changed payloads cannot reuse an existing request. The key is held in the open form, not persisted across navigation, cancellation or browser reload; refresh history before manually re-entering a contact after abandoning an uncertain attempt.

Contact and follow-up instants use `timestamptz`. Existing `tasks.task_date` uses a local timestamp, so the RPC converts the follow-up using the submitting browser's IANA time zone. The form displays that zone and rejects nonexistent local times during the spring DST gap. During a repeated autumn hour, JavaScript selects the first matching occurrence. Viewing history formats exact stored instants in the viewer's current local zone. Existing tasks continue to have their established local-time semantics.

## Parallel branch integration

- `codex/contact-followup-link`: confirmed migration `20261107100000_log_communication.sql` comes first. Its `autotrack_log_communication` RPC uses the existing notification `sync_id`; this branch's independent RPC uses `contact_request_id`. Keep both RPCs. Preserve its `handleLogCommunication` and snapshot/version logic when merging `LeadDetailPanel.tsx`; preserve this branch's contact panel and `refreshAfterContact` callback. Its `ScoringService` changes align automatic follow-up timing with recent-contact scoring; those changes remain owned by that branch. Quick Call/Email/Message entries without structured fields remain unstructured notifications in the timeline.
- `codex/unreplied-message-state`: confirmed migration `20261107140000_notification_reply_state.sql` follows this migration. It owns `replied_at`, `mark_notification_replied(p_notification_id)` and statistics. Keep its independent `MessageReplyPanel` after `LeadDetailPanel` in the detail page. `NotificationRepo` only reads the new contact metadata and does not write `replied_at` or clear contact metadata. An outbound record never marks an inbound notification replied. Old notification titles do not establish direction.
- No new application table is introduced. Existing transactional lead deletion continues to cover history/tasks. Recovery/export code must preserve the additional notification columns; this branch does not change production data or apply any migration remotely.

## Verification

Repository and form tests:

```powershell
npm test -- --runInBand tests/integration/persistence/real/ContactHistoryRepo.test.ts tests/integration/persistence/real/RepositoryContracts.test.ts tests/ui/ContactHistoryPanel.test.tsx
npm run typecheck
```

Actual SQL/RLS and rollback checks can run without Docker or hosted credentials:

```powershell
npm install --prefix .test-runtime --no-save --package-lock=false @electric-sql/pglite@0.5.15
node tests/contact-history/database.mjs
```

The runner uses a fresh embedded PostgreSQL instance, the repository's synthetic historical schema, both existing ownership migrations, and the unmodified new migration. It adapts only the historic ownership lookup literal to a synthetic local account. It verifies preservation, owner/anonymous isolation, invalid input, idempotency, version conflict, backdating, distinct same-day follow-ups, rollback on task failure, closed-lead behavior and transactional deletion/tombstones. Auth claims are simulated for RLS; it does not claim to exercise hosted Supabase Auth or PostgREST. `.test-runtime` is ignored and adds no application dependency.

To verify the parallel migration interfaces without merging branches, pass the absolute path to the synchronization migration, then the reply-state migration as the two optional arguments to `database.mjs`. The runner applies synchronization before contact history and replies after contact history, and adds checks for retry-key coexistence and explicit reply marking.

For the desktop/mobile HTTP fixture journey, build once with synthetic local settings, then run the dedicated configuration. It starts only loopback fixture services; the contact RPC is intercepted by the browser test and does not write to a real database.

```powershell
$env:E2E_APP_PORT='3213'
$env:E2E_BACKEND_PORT='54379'
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54379'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key'
npm run build -- --webpack
npx playwright test --config tests/contact-history/playwright.config.ts --project=chromium --project=mobile-chromium
```

Verified on 2026-11-07: 43 focused Jest checks (contact form/repository plus notification regressions), 14 standalone embedded database checks, 16 checks with both peer migrations, desktop and mobile Chromium journeys including zero Axe violations in the new form, production Webpack build, TypeScript and lint of changed code. No migration was applied to a hosted project and no branch was merged or deployed. The original cross-drive dependency junction caused a Windows build-resolution failure; validation used a local copy of only the Next package with other dependencies linked, keeping the shared checkout untouched. An interrupted full dependency installation was removed from this task's worktree.
