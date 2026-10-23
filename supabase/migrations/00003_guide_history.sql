-- 00003_guide_history.sql
-- Adds support for carrier guide history (consultarhistoricoguia endpoint)

-- Allow the new source type for guide movement backfills
alter table order_status_history drop constraint if exists order_status_history_source_check;
alter table order_status_history add constraint order_status_history_source_check
  check (source in ('first_seen', 'poll', 'daily_check', 'dropi_movement', 'guide_movement'));
