-- Digest email tracking
--
-- WHY: the weekly digest has never sent an email. `reef-digest` generates the
-- content and inserts a `sonar_notifications` row, and there it stopped —
-- `weeklyDigestTemplate` in frontend/api/_lib/resend.js had zero callers, so the
-- `emailDigest` preference in Settings collected an intent nothing acted on.
--
-- The send path (frontend/api/retention.js?action=weekly-digest) emails the digest
-- rows that `reef-digest` already produced, rather than regenerating them — one
-- generator, one sender. That needs somewhere to record "this row has been
-- emailed", otherwise a cron retry or an overlapping run double-sends. Sending a
-- duplicate digest is a spam complaint, so this is not optional bookkeeping.
--
-- `email_sent_at` is NULL for every existing row, which is accurate: none of them
-- were ever emailed.
--
-- Filename uses a full YYYYMMDDHHMMSS stamp, per the prefix-collision guard in
-- frontend/src/__tests__/migrationOrder.test.js — the date-only prefixes used by
-- the 20260729/20260731 files collide and cannot be recorded in the CLI ledger.

alter table public.sonar_notifications
  add column if not exists email_sent_at timestamptz;

comment on column public.sonar_notifications.email_sent_at is
  'When this notification was emailed (NULL = never emailed). Set by the weekly-digest sender to make the send idempotent across cron retries.';

-- Partial index: the sender only ever asks for digest rows that still need mailing,
-- so the index covers exactly that predicate rather than the whole table.
create index if not exists sonar_notifications_pending_digest_idx
  on public.sonar_notifications (recipient_wallet, created_at desc)
  where link_type = 'digest' and email_sent_at is null;
