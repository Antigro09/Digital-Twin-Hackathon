-- Phase 3 simulation, prediction, model-registry, and learning records use the
-- tenant-qualified authoritative record store and transactional outbox.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'records_decision_intelligence_identity_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_decision_intelligence_identity_check check (
      kind not in (
        'decision_simulation_snapshot', 'decision_scenario_branch', 'decision_simulation_run',
        'predictive_model_definition', 'prediction_feature_batch', 'prediction_run', 'prediction_knowledge', 'prediction_learning_event'
      )
      or (
        payload ? 'tenant_id'
        and payload->>'tenant_id' = tenant_id::text
        and (
          (kind = 'decision_simulation_snapshot' and payload->>'snapshot_id' = record_id::text)
          or (kind = 'decision_scenario_branch' and payload->>'branch_id' = record_id::text)
          or (kind = 'decision_simulation_run' and payload->>'simulation_id' = record_id::text)
          or (kind = 'predictive_model_definition' and payload->>'model_id' = record_id::text)
          or (kind = 'prediction_feature_batch' and payload->>'feature_batch_id' = record_id::text)
          or (kind = 'prediction_run' and payload->>'prediction_id' = record_id::text)
          or (kind = 'prediction_knowledge' and payload->>'knowledge_id' = record_id::text)
          or (kind = 'prediction_learning_event' and payload->>'learning_event_id' = record_id::text)
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
    where conname = 'records_decision_intelligence_shape_check'
      and conrelid = 'edt.records'::regclass
  ) then
    alter table edt.records add constraint records_decision_intelligence_shape_check check (
      kind not in ('decision_simulation_snapshot', 'decision_scenario_branch', 'predictive_model_definition', 'prediction_feature_batch', 'prediction_run')
      or (
        (kind <> 'decision_simulation_snapshot' or (
          payload ?& array['canonical_sha256', 'graph_version', 'nodes', 'relationships', 'state_hash']
          and jsonb_typeof(payload->'nodes') = 'array'
          and jsonb_typeof(payload->'relationships') = 'array'
        ))
        and (kind <> 'decision_scenario_branch' or (
          payload ?& array['scenario_id', 'snapshot_id', 'kind', 'changes', 'status', 'scenario_digest', 'version', 'state_hash']
          and payload->>'kind' in ('hiring', 'pricing_change', 'supplier_failure', 'expansion', 'budget_change')
          and payload->>'status' in ('draft', 'confirmed')
          and jsonb_typeof(payload->'changes') = 'array'
        ))
        and (kind <> 'predictive_model_definition' or (
          payload ?& array['kind', 'algorithm', 'inputs', 'outputs', 'model_version', 'accuracy', 'owner_id', 'trigger', 'status', 'version', 'state_hash']
          and payload->>'kind' in ('forecasting', 'optimization', 'anomaly_detection', 'computer_vision', 'classification')
          and payload->>'status' in ('draft', 'active', 'retired')
        ))
        and (kind <> 'prediction_feature_batch' or (
          payload ?& array['prediction_id', 'observations', 'observation_count', 'data_hash', 'source', 'state_hash']
          and jsonb_typeof(payload->'observations') = 'array'
          and jsonb_array_length(payload->'observations') between 3 and 10000
        ))
        and (kind <> 'prediction_run' or (
          payload ?& array['model_id', 'kind', 'target', 'result_sha256', 'status', 'version', 'state_hash']
          and payload->>'kind' in ('revenue', 'expense', 'customer_churn', 'workforce', 'risk')
          and payload->>'status' in ('pending_outcome', 'outcome_recorded', 'validated', 'corrected')
        ))
      )
    );
  end if;
end
$$;

create index if not exists records_decision_scenario_snapshot_status_idx
  on edt.records(tenant_id, (payload->>'snapshot_id'), (payload->>'status'), created_at desc, record_id)
  where kind = 'decision_scenario_branch';

create index if not exists records_decision_run_branch_idx
  on edt.records(tenant_id, (payload->>'branch_id'), created_at desc, record_id)
  where kind = 'decision_simulation_run';

create index if not exists records_predictive_model_catalog_idx
  on edt.records(tenant_id, (payload->>'kind'), (payload->>'prediction_kind'), (payload->>'status'), created_at desc, record_id)
  where kind = 'predictive_model_definition';

create index if not exists records_prediction_model_status_idx
  on edt.records(tenant_id, (payload->>'model_id'), (payload->>'status'), created_at desc, record_id)
  where kind = 'prediction_run';

create index if not exists records_prediction_feature_batch_run_idx
  on edt.records(tenant_id, (payload->>'prediction_id'), created_at desc, record_id)
  where kind = 'prediction_feature_batch';

create index if not exists records_prediction_knowledge_model_idx
  on edt.records(tenant_id, (payload->>'model_id'), (payload->>'category'), created_at desc, record_id)
  where kind = 'prediction_knowledge';

create index if not exists records_prediction_learning_model_idx
  on edt.records(tenant_id, (payload->>'model_id'), created_at desc, record_id)
  where kind = 'prediction_learning_event';
