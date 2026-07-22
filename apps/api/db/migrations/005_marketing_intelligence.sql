-- Phase 8 broadens the existing decision-intelligence constraints. Marketing
-- remains in the same tenant-qualified authoritative record store.

alter table edt.records drop constraint if exists records_decision_intelligence_shape_check;

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
      and payload->>'kind' in (
        'hiring', 'pricing_change', 'supplier_failure', 'expansion', 'budget_change',
        'marketing_budget', 'marketing_channel_mix', 'market_entry', 'segment_targeting'
      )
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
      and payload->>'kind' in ('revenue', 'expense', 'customer_churn', 'workforce', 'risk', 'marketing_conversion')
      and payload->>'status' in ('pending_outcome', 'outcome_recorded', 'validated', 'corrected')
    ))
  )
);
