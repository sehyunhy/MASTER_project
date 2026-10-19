-- Apply once to the existing six-table study database. Preserves all rows.
-- Removes exact comparison-word gate from human reasons; keeps a 20-character reason requirement.
begin;
create or replace function public.study_finalize(p_trial_id uuid,p_person_id uuid,p_product_id text,
  p_actor text,p_reason text,p_event_key uuid,p_model text default null,
  p_response_id text default null,p_latency_ms integer default null,p_prompt_version text default null,
  p_evidence_quote text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp(); source_origin text;
  scripted_final_offset integer;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.phase<>'decision' or t.decision_actor<>p_actor then raise exception 'FINAL_ACTION_NOT_ALLOWED'; end if;
  if t.final_product_id is not null then
    if t.final_product_id=p_product_id and t.final_actor=p_actor then return jsonb_build_object('idempotent',true,'product_id',p_product_id); end if;
    raise exception 'FINAL_ALREADY_FIXED';
  end if;
  if t.role='giver' and p_actor='agent' and (t.operation_key is distinct from p_event_key or t.operation_kind<>'final')
    then raise exception 'AGENT_CLAIM_REQUIRED'; end if;
  if t.role='recipient' then
    select (script.message->>'offset_ms')::integer into scripted_final_offset
      from public.study_stimuli s cross join lateral jsonb_array_elements(s.transcript) as script(message)
      where s.id=t.stimulus_id and script.message->>'phase'='decision' and script.message->>'kind'='final_selection'
      limit 1;
    if scripted_final_offset is null or t.phase_effective_ms<scripted_final_offset then
      raise exception 'SCRIPTED_FINAL_NOT_YET_VISIBLE';
    end if;
  end if;
  if not exists(select 1 from jsonb_array_elements(t.candidate_snapshots) item where item->>'source_product_id'=p_product_id)
    then raise exception 'PRODUCT_OUTSIDE_CANDIDATES'; end if;
  if t.role='giver' and p_actor='human' and
    (length(trim(coalesce(p_reason,'')))<20
      or trim(coalesce(p_reason,'')) ~ '^(그냥|알아서|모르겠|좋아)[.!?[:space:]]*$')
    then raise exception 'HUMAN_REASON_REQUIRED'; end if;
  if p_actor='agent' and length(trim(coalesce(p_reason,'')))<15 then raise exception 'AGENT_REASON_REQUIRED'; end if;
  source_origin:=case when t.role='recipient' then 'scripted' when p_actor='agent' then 'agent' else 'participant' end;
  update public.study_trials set final_product_id=p_product_id,final_actor=p_actor,
    final_reason=trim(p_reason),final_at=now_at,operation_key=null,operation_kind=null,
    operation_started_at=null,revision=revision+1,updated_at=now_at where id=t.id;
  if t.role='giver' then
    insert into public.study_messages(trial_id,phase,speaker,origin,kind,content,payload)
    values(t.id,'decision',case when p_actor='agent' then 'agent' else 'participant' end,
      source_origin,'final_selection',coalesce(p_reason,''),jsonb_build_object('source_product_id',p_product_id,'actor',p_actor,
        'model',p_model,'response_id',p_response_id,'latency_ms',p_latency_ms,'prompt_version',p_prompt_version,
        'evidence_quote',p_evidence_quote));
  end if;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload,idempotency_key)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'decision',
    case when t.role='recipient' and p_actor='human' then 'scripted_giver' when p_actor='agent' then 'agent' else 'participant' end,
    source_origin,'final_selection',jsonb_build_object('source_product_id',p_product_id,'actor',p_actor,
      'model',p_model,'response_id',p_response_id,'latency_ms',p_latency_ms,'prompt_version',p_prompt_version,
      'evidence_quote',p_evidence_quote),p_event_key) on conflict do nothing;
  return jsonb_build_object('product_id',p_product_id,'actor',p_actor);
end; $$;
commit;
