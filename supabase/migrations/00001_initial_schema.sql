-- 00001_initial_schema.sql
-- Dropi Ordenes — Phase 0 schema
-- All tables carry tenant_id for multi-tenant from day 1.
-- RLS policies are enabled but permissive for now (tightened in Phase 1).

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid, pgp_sym_encrypt
create extension if not exists "pg_trgm";    -- trigram index for text search

-- ============================================================
-- TENANTS
-- ============================================================
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null default 'America/Mexico_City',
  whatsapp_enabled boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table tenants enable row level security;

-- ============================================================
-- DROPI CONNECTIONS (OAuth tokens per tenant)
-- ============================================================
create table dropi_connections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  access_token    text not null,      -- encrypted with pgp_sym_encrypt
  refresh_token   text not null,      -- encrypted with pgp_sym_encrypt
  expires_at      timestamptz,
  status          text not null default 'ok' check (status in ('ok', 'desconectada')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id)
);

alter table dropi_connections enable row level security;

-- ============================================================
-- ORDERS
-- ============================================================
create table orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  order_id          bigint not null,                     -- Dropi's order id
  status_raw        text not null,                       -- last raw status from Dropi
  stage             text not null,                       -- normalized stage
  max_rank          integer not null default 0,          -- highest rank reached
  customer_name     text,
  phone_e164        text,                                -- +52XXXXXXXXXX
  address           text,
  city              text,
  total             numeric(12,2),
  currency          text not null default 'MXN',
  payment_method    text,
  rate_type         text,
  shipping_company  text,
  tracking_code     text,
  items             jsonb,
  dropi_created_at  timestamptz,
  dropi_updated_at  timestamptz,
  first_seen_at     timestamptz not null default now(),
  last_checked_at   timestamptz not null default now(),
  is_final          boolean not null default false,
  archived_at       timestamptz,

  unique (tenant_id, order_id)
);

create index idx_orders_tenant_stage on orders (tenant_id, stage);
create index idx_orders_tenant_final on orders (tenant_id, is_final) where not is_final;
create index idx_orders_tenant_created on orders (tenant_id, dropi_created_at desc);
create index idx_orders_phone on orders (tenant_id, phone_e164) where phone_e164 is not null;
create index idx_orders_tracking on orders (tracking_code) where tracking_code is not null;

alter table orders enable row level security;

-- ============================================================
-- ORDER STATUS HISTORY
-- ============================================================
create table order_status_history (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  order_id          bigint not null,
  prev_status       text,
  new_status        text not null,
  prev_stage        text,
  new_stage         text not null,
  detected_at       timestamptz not null default now(),
  dropi_updated_at  timestamptz,
  source            text not null default 'poll' check (source in ('first_seen', 'poll', 'daily_check'))
);

create index idx_history_tenant_order on order_status_history (tenant_id, order_id, detected_at);

alter table order_status_history enable row level security;

-- ============================================================
-- STATUS MAP (global, no tenant_id)
-- ============================================================
create table status_map (
  id          serial primary key,
  carrier     text,               -- null = generic
  raw_status  text not null,
  stage       text not null,
  is_final    boolean not null default false,
  needs_review boolean not null default false,
  unique (carrier, raw_status)
);

-- ============================================================
-- POLL RUNS
-- ============================================================
create table poll_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  orders_read integer not null default 0,
  changes     integer not null default 0,
  errors      jsonb
);

create index idx_poll_runs_tenant on poll_runs (tenant_id, started_at desc);

alter table poll_runs enable row level security;

-- ============================================================
-- WHATSAPP TEMPLATES
-- ============================================================
create table whatsapp_templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  key               text not null,
  meta_template_name text,
  language          text not null default 'es_MX',
  stage_trigger     text,
  audience          text not null default 'cliente' check (audience in ('cliente', 'dueño')),
  enabled           boolean not null default true,
  unique (tenant_id, key)
);

alter table whatsapp_templates enable row level security;

-- ============================================================
-- WHATSAPP MESSAGES
-- ============================================================
create table whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  order_id        bigint not null,
  template_key    text,
  to_phone        text not null,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  meta_message_id text,
  error           text,
  created_at      timestamptz not null default now()
);

create index idx_wa_messages_tenant_order on whatsapp_messages (tenant_id, order_id);
create index idx_wa_messages_meta_id on whatsapp_messages (meta_message_id) where meta_message_id is not null;

alter table whatsapp_messages enable row level security;

-- ============================================================
-- ORDER NOTES
-- ============================================================
create table order_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  order_id    bigint not null,
  author_id   uuid,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index idx_notes_tenant_order on order_notes (tenant_id, order_id);

alter table order_notes enable row level security;

-- ============================================================
-- SETTINGS (key-value per tenant)
-- ============================================================
create table settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  key         text not null,
  value       jsonb not null default '{}',
  unique (tenant_id, key)
);

alter table settings enable row level security;
