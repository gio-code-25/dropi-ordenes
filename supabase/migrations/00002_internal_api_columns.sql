-- 00002_internal_api_columns.sql
-- Adds columns discovered from Dropi's internal API (servientrega_movements, etc.)

-- Orders: notes field from Dropi
alter table orders add column if not exists notes text;

-- Order status history: movement tracking from Dropi internal API
alter table order_status_history add column if not exists dropi_movement_id bigint;
alter table order_status_history add column if not exists dropi_timestamp timestamptz;

-- Allow the new source type for movement backfills
alter table order_status_history drop constraint if exists order_status_history_source_check;
alter table order_status_history add constraint order_status_history_source_check
  check (source in ('first_seen', 'poll', 'daily_check', 'dropi_movement'));

-- Make prev_stage / new_stage nullable for movement entries (movements have raw status only, no stage mapping)
alter table order_status_history alter column new_stage drop not null;

-- Unique index on dropi_movement_id to make backfill idempotent
create unique index if not exists idx_history_movement_id
  on order_status_history (tenant_id, order_id, dropi_movement_id)
  where dropi_movement_id is not null;
