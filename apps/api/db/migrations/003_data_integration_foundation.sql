-- Phase 2 operational events, quality observations, connector definitions,
-- and MCP definitions share edt.records so they inherit RLS, audit, outbox,
-- and idempotency. These constraints prevent malformed JSON records from
-- bypassing the application contract and add the indexes used by bounded
-- quality and registry queries.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'records_data_foundation_identity_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_data_foundation_identity_check check (
      kind not in (
        'twin_data_foundation_metadata',
        'twin_integration_metadata',
        'twin_event',
        'twin_data_point',
        'twin_connector_definition',
        'twin_mcp_server_definition'
      )
      or (
        payload ? 'tenant_id'
        and payload->>'tenant_id' = tenant_id::text
        and (
          (kind = 'twin_data_foundation_metadata' and payload->>'metadata_id' = record_id::text)
          or (kind = 'twin_integration_metadata' and payload->>'metadata_id' = record_id::text)
          or (kind = 'twin_event' and payload->>'event_id' = record_id::text)
          or (kind = 'twin_data_point' and payload->>'data_point_id' = record_id::text)
          or (kind = 'twin_connector_definition' and payload->>'connector_id' = record_id::text)
          or (kind = 'twin_mcp_server_definition' and payload->>'mcp_server_id' = record_id::text)
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
    where conname = 'records_data_foundation_shape_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_data_foundation_shape_check check (
      kind not in ('twin_event', 'twin_data_point', 'twin_connector_definition', 'twin_mcp_server_definition')
      or (
        (kind <> 'twin_event' or (
          payload ?& array['type_id', 'category', 'occurred_at', 'source', 'affected_node_ids', 'severity', 'outcome', 'confidence_score', 'data_quality']
          and payload->>'category' in ('employee_change', 'system_failure', 'customer_change', 'financial_change', 'market_change', 'operational_change')
          and payload->>'severity' in ('info', 'low', 'medium', 'high', 'critical')
          and payload->>'outcome' in ('observed', 'mitigated', 'resolved', 'failed', 'unknown')
          and jsonb_typeof(payload->'affected_node_ids') = 'array'
        ))
        and (kind <> 'twin_data_point' or (
          payload ?& array['subject_key', 'metric', 'metric_key', 'source', 'observed_at', 'last_updated_at', 'reliability_score', 'confidence_score', 'data_quality']
          and jsonb_typeof(payload->'reliability_score') = 'number'
          and jsonb_typeof(payload->'confidence_score') = 'number'
          and (payload->>'reliability_score')::numeric between 0 and 1
          and (payload->>'confidence_score')::numeric between 0 and 1
        ))
        and (kind <> 'twin_connector_definition' or (
          payload ?& array['name_key', 'kind', 'authentication', 'schema', 'mapping', 'permissions', 'sync', 'error_handling', 'reliability_score', 'status', 'version']
          and payload->>'kind' in ('erp', 'crm', 'hris', 'accounting', 'api', 'database', 'document')
          and payload->>'status' in ('draft', 'active', 'suspended', 'archived')
          and (payload->>'reliability_score')::numeric between 0 and 1
        ))
        and (kind <> 'twin_mcp_server_definition' or (
          payload ?& array['name_key', 'purpose', 'authentication', 'tools', 'permissions', 'connected_data', 'status', 'version']
          and payload->>'status' in ('draft', 'active', 'suspended', 'archived')
          and jsonb_typeof(payload->'tools') = 'array'
          and jsonb_typeof(payload->'connected_data') = 'array'
        ))
      )
    );
  end if;
end
$$;

create index if not exists records_twin_event_category_time_idx
  on edt.records(tenant_id, (payload->>'category'), ((payload->>'occurred_at')::timestamptz) desc, record_id)
  where kind = 'twin_event';

create index if not exists records_twin_event_severity_outcome_idx
  on edt.records(tenant_id, (payload->>'severity'), (payload->>'outcome'), record_id)
  where kind = 'twin_event';

create index if not exists records_twin_event_affected_nodes_gin_idx
  on edt.records using gin ((payload->'affected_node_ids'))
  where kind = 'twin_event';

create index if not exists records_twin_data_point_source_quality_idx
  on edt.records(tenant_id, (payload->>'source_fingerprint'), (payload->>'value_hash'), created_at desc, record_id)
  where kind = 'twin_data_point';

create index if not exists records_twin_data_point_subject_metric_idx
  on edt.records(tenant_id, (payload->>'subject_key'), (payload->>'metric_key'), ((payload->>'observed_at')::timestamptz) desc, record_id)
  where kind = 'twin_data_point';

create index if not exists records_twin_data_point_payload_gin_idx
  on edt.records using gin (payload jsonb_path_ops)
  where kind = 'twin_data_point';

create index if not exists records_twin_connector_kind_status_idx
  on edt.records(tenant_id, (payload->>'kind'), (payload->>'status'), created_at desc, record_id)
  where kind = 'twin_connector_definition';

create index if not exists records_twin_connector_payload_gin_idx
  on edt.records using gin (payload jsonb_path_ops)
  where kind = 'twin_connector_definition';

create unique index if not exists records_twin_connector_active_name_uidx
  on edt.records(tenant_id, (payload->>'name_key'))
  where kind = 'twin_connector_definition' and payload->>'status' <> 'archived';

create index if not exists records_twin_mcp_server_status_idx
  on edt.records(tenant_id, (payload->>'status'), created_at desc, record_id)
  where kind = 'twin_mcp_server_definition';

create index if not exists records_twin_mcp_server_payload_gin_idx
  on edt.records using gin (payload jsonb_path_ops)
  where kind = 'twin_mcp_server_definition';

create unique index if not exists records_twin_mcp_server_active_name_uidx
  on edt.records(tenant_id, (payload->>'name_key'))
  where kind = 'twin_mcp_server_definition' and payload->>'status' <> 'archived';
