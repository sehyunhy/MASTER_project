-- Additive experiment v2 schema. Existing participant/trial rows and assignments are preserved.
alter table public.participants alter column experiment_version set default '2.0.0';
alter table public.participants add column if not exists profile_rotation_offset smallint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='participants_profile_rotation_offset_check' and conrelid='public.participants'::regclass) then
    alter table public.participants add constraint participants_profile_rotation_offset_check check (profile_rotation_offset between 0 and 3);
  end if;
end $$;
alter table public.trials alter column experiment_version set default '2.0.0';
alter table public.trials add column if not exists current_phase text not null default 'criteria';
alter table public.trials add column if not exists scenario_id text;
alter table public.trials add column if not exists dataset_version text not null default 'gift-catalog-v2';
alter table public.trials add column if not exists prompt_version text not null default 'gift-agent-v2';
alter table public.trials add column if not exists model_version text not null default 'controlled-fixture-v2';
alter table public.trials add column if not exists active_tab_id text;
alter table public.trials add column if not exists active_tab_lease_until timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='trials_current_phase_check' and conrelid='public.trials'::regclass) then
    alter table public.trials add constraint trials_current_phase_check
      check (current_phase in ('criteria','candidates','comparison','decision','awaiting_survey','completed'));
  end if;
end $$;

-- Preserve the best recoverable state for trials created before v2; do not fabricate exposure data.
update public.trials t set current_phase = case
  when t.status = 'completed' then 'completed'
  when t.status = 'awaiting_survey' then 'awaiting_survey'
  when exists (select 1 from public.final_selections f where f.trial_id=t.id) then 'awaiting_survey'
  when exists (select 1 from public.event_logs e where e.trial_id=t.id and e.event_type in ('human_selection_screen_shown','agent_selection_started','agent_final_selection','human_final_selection')) then 'decision'
  when exists (select 1 from public.event_logs e where e.trial_id=t.id and e.event_type='comparison_shown') then 'comparison'
  when exists (select 1 from public.event_logs e where e.trial_id=t.id and e.event_type in ('candidates_shown','candidate_shown')) then 'candidates'
  else 'criteria' end
where t.experiment_version <> '2.0.0';

alter table public.product_catalog add column if not exists currency text not null default 'KRW';
alter table public.product_catalog add column if not exists brand text;
alter table public.product_catalog add column if not exists model text;
alter table public.product_catalog add column if not exists image_source text not null default 'category_illustration';
alter table public.product_catalog add column if not exists specifications jsonb not null default '{}'::jsonb;
alter table public.product_catalog add column if not exists use_cases text[] not null default '{}';
alter table public.product_catalog add column if not exists strengths text[] not null default '{}';
alter table public.product_catalog add column if not exists limitations text[] not null default '{}';
alter table public.product_catalog add column if not exists care_requirements text;
alter table public.product_catalog add column if not exists source_type text not null default 'synthetic_qa';
alter table public.product_catalog add column if not exists source_url text;
alter table public.product_catalog add column if not exists verified_at timestamptz;
alter table public.product_catalog add column if not exists dataset_version text not null default 'product-catalog-v1';
alter table public.product_catalog add column if not exists profile_codes text[] not null default '{}';
alter table public.product_catalog add column if not exists fit_tags text[] not null default '{}';
alter table public.gift_candidates add column if not exists product_catalog_id uuid references public.product_catalog(id);
alter table public.gift_candidates add column if not exists product_snapshot jsonb not null default '{}'::jsonb;
alter table public.gift_candidates alter column preference_score drop not null;
alter table public.gift_candidates alter column practicality_score drop not null;
alter table public.gift_candidates alter column budget_score drop not null;
alter table public.gift_candidates alter column overall_score drop not null;
alter table public.trial_candidates add column if not exists product_snapshot jsonb not null default '{}'::jsonb;
alter table public.trial_candidates add column if not exists is_simulated boolean not null default false;

alter table public.event_logs add column if not exists phase text;
alter table public.event_logs add column if not exists actor_type text not null default 'participant'
  check (actor_type in ('participant','agent','system','simulated_giver'));
alter table public.event_logs add column if not exists task_id text;
alter table public.event_logs add column if not exists message_id uuid;
alter table public.event_logs add column if not exists effective_exposure_ms integer;
alter table public.event_logs add column if not exists simulated_actor_event boolean not null default false;
alter table public.event_logs add column if not exists participant_code text;
alter table public.event_logs add column if not exists idempotency_key text;
create unique index if not exists idx_event_logs_trial_idempotency on public.event_logs(trial_id,idempotency_key) where idempotency_key is not null;

create table if not exists public.trial_phase_exposures (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references public.trials(id) on delete cascade,
  phase text not null check (phase in ('criteria','candidates','comparison')),
  content_ready_at timestamptz,
  last_heartbeat_at timestamptz,
  accumulated_ms integer not null default 0 check (accumulated_ms >= 0),
  threshold_met_at timestamptz,
  last_sequence bigint not null default -1,
  active_tab_id text,
  lease_until timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (trial_id, phase)
);
create index if not exists idx_phase_exposures_trial on public.trial_phase_exposures(trial_id, phase);
alter table public.trial_phase_exposures enable row level security;
alter table public.trial_phase_exposures add column if not exists threshold_met_at timestamptz;

create table if not exists public.trial_messages (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references public.trials(id) on delete cascade,
  phase text not null check (phase in ('criteria','candidates','comparison','decision','awaiting_survey')),
  actor_type text not null check (actor_type in ('participant','agent','system','simulated_giver')),
  message_type text not null check (message_type in ('text','product_cards','comparison','task_request','decision')),
  content text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  rendered_at timestamptz,
  simulated_actor_event boolean not null default false,
  created_at timestamptz not null default now(),
  unique (trial_id, idempotency_key)
);
create index if not exists idx_trial_messages_time on public.trial_messages(trial_id, created_at);
alter table public.trial_messages enable row level security;

create or replace function public.phase_content_ready(p_trial_id uuid, p_phase text, p_tab_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_now timestamptz := clock_timestamp(); v_trial public.trials%rowtype; v_row public.trial_phase_exposures%rowtype;
begin
  select * into v_trial from public.trials where id=p_trial_id for update;
  if not found or v_trial.current_phase <> p_phase then raise exception 'PHASE_MISMATCH'; end if;
  if p_phase='candidates' and (select count(*) from public.trial_candidates where trial_id=p_trial_id)<>3 then raise exception 'CANDIDATES_NOT_READY'; end if;
  if p_phase='criteria' and not exists(select 1 from public.trial_messages where trial_id=p_trial_id and idempotency_key='criteria-opening-v2' and rendered_at is not null) then raise exception 'CONTENT_NOT_READY'; end if;
  if p_phase='candidates' and not exists(select 1 from public.trial_messages where trial_id=p_trial_id and idempotency_key='catalog-candidates-v2' and rendered_at is not null) then raise exception 'CONTENT_NOT_READY'; end if;
  if p_phase='comparison' and not exists(select 1 from public.trial_messages where trial_id=p_trial_id and idempotency_key='comparison-v2' and rendered_at is not null) then raise exception 'CONTENT_NOT_READY'; end if;
  insert into public.trial_phase_exposures(trial_id,phase) values(p_trial_id,p_phase) on conflict(trial_id,phase) do nothing;
  select * into v_row from public.trial_phase_exposures where trial_id=p_trial_id and phase=p_phase for update;
  if v_row.lease_until > v_now and v_row.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  update public.trial_phase_exposures set
    content_ready_at=coalesce(content_ready_at,v_now), last_heartbeat_at=v_now,
    threshold_met_at=case when accumulated_ms>=30000 then coalesce(threshold_met_at,v_now) else threshold_met_at end,
    active_tab_id=p_tab_id, lease_until=v_now+interval '12 seconds', paused_at=null, updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase;
  return jsonb_build_object('ready',true,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=30000,'server_now',v_now);
end; $$;

create or replace function public.phase_heartbeat(p_trial_id uuid, p_phase text, p_tab_id text, p_sequence bigint, p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_now timestamptz := clock_timestamp(); v_trial public.trials%rowtype; v_row public.trial_phase_exposures%rowtype; v_delta integer := 0;
begin
  select * into v_trial from public.trials where id=p_trial_id for update;
  if not found or v_trial.current_phase <> p_phase then raise exception 'PHASE_MISMATCH'; end if;
  select * into v_row from public.trial_phase_exposures where trial_id=p_trial_id and phase=p_phase for update;
  if not found or v_row.content_ready_at is null then raise exception 'CONTENT_NOT_READY'; end if;
  if p_sequence <= v_row.last_sequence then
    return jsonb_build_object('accepted',false,'reason','stale_sequence','accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=30000);
  end if;
  if v_row.lease_until > v_now and v_row.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  if v_row.paused_at is null and v_row.last_heartbeat_at is not null then
    v_delta := greatest(0, floor(extract(epoch from (v_now-v_row.last_heartbeat_at))*1000)::integer);
    -- A delayed/offline heartbeat never credits the missing interval.
    if v_delta > 5000 then v_delta := 0; end if;
  end if;
  update public.trial_phase_exposures set
    accumulated_ms=accumulated_ms+v_delta,
    threshold_met_at=case when v_row.accumulated_ms+v_delta>=30000 then coalesce(v_row.threshold_met_at,v_now) else v_row.threshold_met_at end,
    last_heartbeat_at=case when p_active then v_now else null end,
    last_sequence=p_sequence, active_tab_id=p_tab_id,
    lease_until=case when p_active then v_now+interval '12 seconds' else v_now+interval '12 seconds' end,
    paused_at=case when p_active then null else coalesce(paused_at,v_now) end, updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase returning * into v_row;
  return jsonb_build_object('accepted',true,'delta_ms',v_delta,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=30000,'server_now',v_now);
end; $$;

drop function if exists public.advance_trial_phase(uuid,text,text);
create or replace function public.advance_trial_phase(p_trial_id uuid, p_expected_phase text, p_actor text, p_tab_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_now timestamptz := clock_timestamp(); v_trial public.trials%rowtype; v_exposure public.trial_phase_exposures%rowtype; v_next text;
begin
  select * into v_trial from public.trials where id=p_trial_id for update;
  if not found then raise exception 'PHASE_MISMATCH'; end if;
  v_next := case p_expected_phase when 'criteria' then 'candidates' when 'candidates' then 'comparison' when 'comparison' then 'decision' end;
  if v_trial.current_phase=v_next then return jsonb_build_object('phase',v_next,'idempotent',true); end if;
  if v_trial.current_phase <> p_expected_phase then raise exception 'PHASE_MISMATCH'; end if;
  select * into v_exposure from public.trial_phase_exposures where trial_id=p_trial_id and phase=p_expected_phase for update;
  if not found or v_exposure.accumulated_ms < 30000 then raise exception 'MIN_EXPOSURE_NOT_MET'; end if;
  if p_tab_id is null or v_exposure.active_tab_id is distinct from p_tab_id or v_exposure.lease_until < v_now or v_exposure.last_heartbeat_at is null or v_exposure.last_heartbeat_at < v_now-interval '5 seconds' then raise exception 'CONTENT_NOT_ACTIVE'; end if;
  if p_expected_phase in ('criteria','candidates') then
    if p_actor='human_request' and v_trial.execution_autonomy <> 'human_guided' then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor='agent' and v_trial.execution_autonomy <> 'agent_autonomous' then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor not in ('human_request','agent','simulated_giver') then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor='simulated_giver' and not exists(select 1 from public.trials t join public.participants p on p.id=t.participant_id where t.id=p_trial_id and p.role='recipient') then raise exception 'ACTOR_NOT_ALLOWED'; end if;
  elsif p_expected_phase='comparison' then
    if p_actor='human' and v_trial.decision_authority <> 'human' then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor='agent' and v_trial.decision_authority <> 'agent' then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor='simulated_giver' and not exists(select 1 from public.trials t join public.participants p on p.id=t.participant_id where t.id=p_trial_id and p.role='recipient') then raise exception 'ACTOR_NOT_ALLOWED'; end if;
    if p_actor not in ('human','agent','simulated_giver') then raise exception 'ACTOR_NOT_ALLOWED'; end if;
  else raise exception 'PHASE_NOT_ADVANCEABLE'; end if;
  if p_expected_phase='candidates' and (select count(*) from public.trial_candidates where trial_id=p_trial_id)<>3 then raise exception 'CANDIDATES_NOT_READY'; end if;
  update public.trial_phase_exposures set completed_at=coalesce(completed_at,v_now), updated_at=v_now where trial_id=p_trial_id and phase=p_expected_phase;
  update public.trials set current_phase=v_next, status=case when v_next='candidates' then 'active' else status end,
    active_tab_id=null, active_tab_lease_until=null where id=p_trial_id;
  return jsonb_build_object('phase',v_next,'advanced_at',v_now);
end; $$;

create or replace function public.finalize_trial_selection(p_trial_id uuid, p_participant_id uuid, p_candidate_id uuid, p_actor text, p_is_simulated boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_trial public.trials%rowtype; v_phase public.trial_phase_exposures%rowtype; v_selection_id uuid;
begin
  select * into v_trial from public.trials where id=p_trial_id and participant_id=p_participant_id for update;
  if not found then raise exception 'DECISION_PHASE_REQUIRED'; end if;
  if v_trial.current_phase='awaiting_survey' then
    select id into v_selection_id from public.final_selections where trial_id=p_trial_id and selected_candidate_id=p_candidate_id and selected_by=p_actor and is_mock=p_is_simulated;
    if found then return jsonb_build_object('selection_id',v_selection_id,'phase','awaiting_survey','idempotent',true); end if;
    raise exception 'FINAL_SELECTION_ALREADY_SET';
  end if;
  if v_trial.current_phase <> 'decision' then raise exception 'DECISION_PHASE_REQUIRED'; end if;
  if v_trial.status <> 'active' then raise exception 'TRIAL_NOT_ACTIVE'; end if;
  if p_actor <> v_trial.decision_authority then raise exception 'ACTOR_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.trial_candidates where trial_id=p_trial_id and gift_candidate_id=p_candidate_id) then raise exception 'CANDIDATE_NOT_IN_TRIAL'; end if;
  insert into public.final_selections(trial_id,selected_candidate_id,selected_by,is_mock)
  values(p_trial_id,p_candidate_id,p_actor,p_is_simulated) returning id into v_selection_id;
  update public.trials set status='awaiting_survey', current_phase='awaiting_survey', active_tab_id=null, active_tab_lease_until=null where id=p_trial_id;
  return jsonb_build_object('selection_id',v_selection_id,'phase','awaiting_survey');
end; $$;

revoke all on function public.phase_content_ready(uuid,text,text) from public, anon, authenticated;
revoke all on function public.phase_heartbeat(uuid,text,text,bigint,boolean) from public, anon, authenticated;
revoke all on function public.advance_trial_phase(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.finalize_trial_selection(uuid,uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.phase_content_ready(uuid,text,text) to service_role;
grant execute on function public.phase_heartbeat(uuid,text,text,bigint,boolean) to service_role;
grant execute on function public.advance_trial_phase(uuid,text,text,text) to service_role;
grant execute on function public.finalize_trial_selection(uuid,uuid,uuid,text,boolean) to service_role;

-- New, not-yet-started canonical slots retain code, role, sequence, and intimacy.
-- Their deterministic profile rotation balances every condition × profile cell.
update public.participants p set
  profile_rotation_offset=case
    when mod((substring(p.participant_code from 2)::integer - case when p.role='recipient' then 41 else 1 end),5)<4
      then mod((substring(p.participant_code from 2)::integer - case when p.role='recipient' then 41 else 1 end),5)::smallint
    when p.intimacy_condition='high' then 0::smallint else 1::smallint end,
  experiment_version='2.0.0'
where p.status='assigned' and p.started_at is null
  and p.participant_code ~ '^P[0-9]{3}$'
  and ((p.role='giver' and substring(p.participant_code from 2)::integer between 1 and 40)
    or (p.role='recipient' and substring(p.participant_code from 2)::integer between 41 and 80))
  and not exists(select 1 from public.trials t where t.participant_id=p.id);
