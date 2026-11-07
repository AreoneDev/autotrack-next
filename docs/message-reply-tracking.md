# Reply tracking

Dependency: integrate codex/complete-contact-history first and apply its
20261107130000_complete_contact_history.sql migration before
20261107140000_notification_reply_state.sql. Neither migration is applied by this branch.

notifications.contact_direction is the source of truth for inbound/outbound.
Only explicit inbound records with a lead and a valid received timestamp count.
Old titles, Lead.lastInteractionBy and arbitrary outbound contacts never infer replies.
Incoming records are currently manually recorded contacts; there is no live email/SMS inbox integration.

Each valid inbound record starts pending_reply. Mark as replied acknowledges exactly
that record with replied_at, after the user has responded. It is an explicit acknowledgement,
not evidence that this app sent a message. Additional inbound records start pending independently.
received = pending + replied. Invalid timestamps, unknown direction and orphan records are excluded.
The Dashboard label describes recorded incoming contacts because the source also includes calls.

The RPC uses caller permissions and existing owner RLS, validates ownership and inbound direction,
locks the row and preserves the first timestamp on retries. It cannot acknowledge another owner's
record or an outbound contact. Closing a lead does not acknowledge its pending contacts.

Dashboard shows Unavailable on missing columns, read failures or partial reads, and 0 only
after a successful read with no pending inbound records. Detail status uses the same classifier.
NotificationRepo in the contact-history branch must not default replied_at to null on updates.
For integration, keep both the ContactHistoryPanel and the independent MessageReplyPanel in
app/leads/[id]/page.tsx. Their page import/data additions are the only expected overlap.

Validation: unit classifier and Dashboard tests; repository error/pagination/RPC tests;
UI retry tests; TypeScript and ESLint. Database execution additionally requires a disposable
PostgreSQL/Supabase instance and the dependency migration. No hosted database is used.

