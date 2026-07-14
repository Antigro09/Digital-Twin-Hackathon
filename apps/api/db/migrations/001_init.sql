create schema if not exists edt;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'edt_app') then
    create role edt_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;
alter role edt_app nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

create table if not exists edt.tenants (
  tenant_id uuid primary key,
  alias text not null unique,
  display_name text not null,
  synthetic boolean not null default false,
  created_at timestamptz not null default transaction_timestamp()
);

insert into edt.tenants(tenant_id, alias, display_name, synthetic) values
  ('10000000-0000-4000-8000-000000000001', 'tnt_aster', 'Aster Labs', true),
  ('10000000-0000-4000-8000-000000000002', 'tnt_beacon', 'Beacon Works', true)
on conflict (tenant_id) do update set alias = excluded.alias, display_name = excluded.display_name, synthetic = excluded.synthetic;

create table if not exists edt.records (
  tenant_id uuid not null references edt.tenants(tenant_id),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  record_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  primary key (tenant_id, kind, record_id)
);

create table if not exists edt.idempotency (
  tenant_id uuid not null references edt.tenants(tenant_id),
  operation text not null,
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  request_hash char(64) not null,
  response_ref uuid,
  state text not null check (state in ('running','succeeded','failed')),
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null,
  primary key (tenant_id, operation, idempotency_key)
);

create table if not exists edt.outbox (
  outbox_id bigserial primary key,
  tenant_id uuid not null references edt.tenants(tenant_id),
  event_id uuid not null unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version integer not null check (aggregate_version > 0),
  payload jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  published_at timestamptz
);

create table if not exists edt.audit_events (
  tenant_id uuid not null references edt.tenants(tenant_id),
  tenant_sequence bigint not null,
  event_id uuid not null,
  payload jsonb not null,
  previous_hash char(64) not null,
  event_hash char(64) not null,
  occurred_at timestamptz not null,
  primary key (tenant_id, tenant_sequence),
  unique (tenant_id, event_id)
);

alter table edt.records enable row level security;
alter table edt.records force row level security;
alter table edt.idempotency enable row level security;
alter table edt.idempotency force row level security;
alter table edt.outbox enable row level security;
alter table edt.outbox force row level security;
alter table edt.audit_events enable row level security;
alter table edt.audit_events force row level security;

drop policy if exists records_tenant_isolation on edt.records;
create policy records_tenant_isolation on edt.records using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists idempotency_tenant_isolation on edt.idempotency;
create policy idempotency_tenant_isolation on edt.idempotency using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists outbox_tenant_isolation on edt.outbox;
create policy outbox_tenant_isolation on edt.outbox using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists audit_tenant_isolation on edt.audit_events;
create policy audit_tenant_isolation on edt.audit_events using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index if not exists records_kind_created_idx on edt.records(tenant_id, kind, created_at, record_id);
create index if not exists outbox_unpublished_idx on edt.outbox(tenant_id, outbox_id) where published_at is null;

grant usage on schema edt to edt_app;
grant select, insert, update, delete on edt.records, edt.idempotency, edt.outbox, edt.audit_events to edt_app;
grant usage, select on all sequences in schema edt to edt_app;
