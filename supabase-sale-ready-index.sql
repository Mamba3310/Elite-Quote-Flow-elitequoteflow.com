-- Phase 3/4: create the index separately, outside any transaction.
-- CONCURRENTLY reduces blocking while existing quotes are scanned.
create index concurrently if not exists quotes_reminder_due_idx
  on public.quotes (follow_up, last_reminder_at) where status = 'sent';
