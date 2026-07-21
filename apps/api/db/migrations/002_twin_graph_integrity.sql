-- Canonical enterprise-twin graph records are stored in edt.records so they
-- inherit the existing RLS, audit, outbox, idempotency, and rebuild controls.
-- These checks retain the flexibility of JSON extension fields while making
-- tenant identity and graph record identity database-enforced invariants.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'records_twin_graph_identity_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_twin_graph_identity_check check (
      kind not in ('twin_graph_metadata', 'twin_node', 'twin_relationship', 'twin_graph_history')
      or (
        payload ? 'tenant_id'
        and payload->>'tenant_id' = tenant_id::text
        and (
          (kind = 'twin_graph_metadata' and payload->>'metadata_id' = record_id::text)
          or (kind = 'twin_node' and payload->>'node_id' = record_id::text)
          or (kind = 'twin_relationship' and payload->>'relationship_id' = record_id::text)
          or (kind = 'twin_graph_history' and payload->>'event_id' = record_id::text)
        )
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'records_twin_graph_version_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_twin_graph_version_check check (
      kind not in ('twin_graph_metadata', 'twin_node', 'twin_relationship')
      or (
        jsonb_typeof(payload->'version') = 'number'
        and (payload->>'version') ~ '^[1-9][0-9]*$'
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'records_twin_graph_shape_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_twin_graph_shape_check check (
      kind not in ('twin_node', 'twin_relationship', 'twin_graph_history')
      or (
        (kind <> 'twin_node' or (
          payload ? 'type_id'
          and payload ? 'label'
          and payload->>'state' in ('active', 'archived')
          and payload->'metadata'->>'classification' in ('public', 'internal', 'confidential', 'restricted')
        ))
        and (kind <> 'twin_relationship' or (
          payload ? 'type_id'
          and payload ? 'source_node_id'
          and payload ? 'target_node_id'
          and payload->>'state' in ('active', 'archived')
          and payload->'metadata'->>'classification' in ('public', 'internal', 'confidential', 'restricted')
          and jsonb_typeof(payload->'strength') = 'number'
          and jsonb_typeof(payload->'confidence') = 'number'
          and jsonb_typeof(payload->'importance') = 'number'
          and jsonb_typeof(payload->'risk') = 'number'
          and jsonb_typeof(payload->'cost') = 'number'
        ))
        and (kind <> 'twin_graph_history' or (
          payload ? 'event_type'
          and payload ? 'resource_kind'
          and payload ? 'resource_id'
          and payload ? 'occurred_at'
        ))
      )
    );
  end if;
end
$$;

create index if not exists records_twin_node_type_state_idx
  on edt.records(tenant_id, (payload->>'type_id'), (payload->>'state'), record_id)
  where kind = 'twin_node';

create index if not exists records_twin_node_owner_idx
  on edt.records(tenant_id, (payload->>'owner_id'), record_id)
  where kind = 'twin_node';

create index if not exists records_twin_relationship_source_idx
  on edt.records(tenant_id, (payload->>'source_node_id'), (payload->>'type_id'), record_id)
  where kind = 'twin_relationship';

create index if not exists records_twin_relationship_target_idx
  on edt.records(tenant_id, (payload->>'target_node_id'), (payload->>'type_id'), record_id)
  where kind = 'twin_relationship';

create index if not exists records_twin_graph_history_resource_idx
  on edt.records(tenant_id, (payload->>'resource_kind'), (payload->>'resource_id'), record_id)
  where kind = 'twin_graph_history';

create index if not exists records_twin_node_payload_gin_idx
  on edt.records using gin (payload jsonb_path_ops)
  where kind = 'twin_node';
