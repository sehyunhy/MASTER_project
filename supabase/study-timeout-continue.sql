-- Apply once in Supabase SQL Editor to an existing study-fresh installation.
-- Preserves all participants, trials, messages, products and events.
-- The original study-fresh.sql is for a new empty setup and MUST NOT be rerun on live data.
begin;
alter table public.study_trials add column if not exists skipped_at timestamptz;
alter table public.study_trials drop constraint if exists study_trials_phase_check;
alter table public.study_trials add constraint study_trials_phase_check
  check (phase in ('locked','candidates','decision','survey','complete','timeout','skipped'));

create or replace function public.study_activate(p_person_id uuid,p_trial_id uuid,p_code text,p_attempt_key uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare p public.study_people%rowtype; t public.study_trials%rowtype; previous public.study_trials%rowtype;
  expected text; accepted boolean; prior_attempt public.study_events%rowtype;
  now_at timestamptz:=clock_timestamp();
begin
  select * into p from public.study_people where id=p_person_id for update;
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if p.id is null or t.id is null or p.status<>'active' or p.active_role<>t.role then raise exception 'ROLE_NOT_ACTIVE'; end if;
  select * into prior_attempt from public.study_events where trial_id=t.id and idempotency_key=p_attempt_key;
  if prior_attempt.id is not null then
    return jsonb_build_object('accepted',coalesce((prior_attempt.payload->>'accepted')::boolean,false),
      'idempotent',true,'phase',t.phase);
  end if;
  if t.phase<>'locked' then return jsonb_build_object('accepted',t.phase<>'timeout','already_active',true,'phase',t.phase); end if;
  if t.order_position>1 then
    select * into previous from public.study_trials where person_id=p.id and role=t.role and order_position=t.order_position-1;
    if not coalesce(previous.phase='complete' and previous.survey_completed_at is not null
      or previous.phase='skipped' and previous.skipped_at is not null,false) then raise exception 'PREVIOUS_SURVEY_REQUIRED'; end if;
  end if;
  expected:=case t.order_position
    when 1 then '26d228663f13a88592a12d16cf9587caab0388b262d6d9f126ed62f9333aca94'
    when 2 then 'e6fcc0253ed7a328a10eb6e2e1ad6abcad60c374c64dbac4b76da610085b43d8'
    when 3 then '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
    else '7e9d8f999b81df9edb764eaa5473f5e7d39c45ad9c8948eee0c210430bd9c1c5' end;
  accepted:=encode(digest(coalesce(p_code,''),'sha256'),'hex')=expected;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload,idempotency_key)
  values(p.id,t.id,t.role,t.condition,t.order_position,t.phase,'participant','participant',
    'transition_code_attempt',jsonb_build_object('accepted',accepted),p_attempt_key)
  on conflict do nothing;
  if not accepted then return jsonb_build_object('accepted',false); end if;
  update public.study_trials set phase='candidates',updated_at=now_at where id=t.id;
  return jsonb_build_object('accepted',true,'phase','candidates');
end; $$;

create or replace function public.study_finish_survey(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; p public.study_people%rowtype; remaining integer; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.phase<>'survey' or t.final_product_id is null then raise exception 'SURVEY_NOT_READY'; end if;
  update public.study_trials set phase='complete',survey_completed_at=now_at,updated_at=now_at where id=t.id;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'survey','participant','participant','paper_survey_completed');
  select count(*) into remaining from public.study_trials where person_id=t.person_id and role=t.role and phase not in ('complete','skipped');
  if remaining=0 then
    select * into p from public.study_people where id=t.person_id for update;
    update public.study_people set active_role=case when p.active_role=p.role_order[1] then p.role_order[2] else 'done' end,
      status=case when p.active_role=p.role_order[1] then 'active' else 'completed' end,updated_at=now_at where id=p.id;
  end if;
  return jsonb_build_object('complete',true,'role_complete',remaining=0);
end; $$;

create or replace function public.study_skip_timed_out(p_trial_id uuid,p_person_id uuid,p_event_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; p public.study_people%rowtype; remaining integer;
  now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or p_event_key is null then raise exception 'TRIAL_NOT_FOUND'; end if;
  if t.phase='skipped' then return jsonb_build_object('skipped',true,'idempotent',true); end if;
  if t.phase<>'timeout' or t.timed_out_at is null then raise exception 'TIMEOUT_REQUIRED'; end if;
  update public.study_trials set phase='skipped',skipped_at=now_at,
    candidates_effective_ms=case when t.timeout_phase='candidates' then t.phase_effective_ms else candidates_effective_ms end,
    candidates_ended_at=case when t.timeout_phase='candidates' then coalesce(candidates_ended_at,t.timed_out_at) else candidates_ended_at end,
    decision_effective_ms=case when t.timeout_phase='decision' then t.phase_effective_ms else decision_effective_ms end,
    decision_ended_at=case when t.timeout_phase='decision' then coalesce(decision_ended_at,t.timed_out_at) else decision_ended_at end,
    updated_at=now_at where id=t.id;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload,idempotency_key)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,t.timeout_phase,'participant','participant',
    'condition_skipped_after_timeout',jsonb_build_object('effective_ms',t.phase_effective_ms,
      'confirmed_candidates',jsonb_array_length(t.candidate_snapshots),'has_final',t.final_product_id is not null),p_event_key)
  on conflict do nothing;
  select count(*) into remaining from public.study_trials where person_id=t.person_id and role=t.role
    and phase not in ('complete','skipped');
  if remaining=0 then
    select * into p from public.study_people where id=t.person_id for update;
    update public.study_people set active_role=case when p.active_role=p.role_order[1] then p.role_order[2] else 'done' end,
      status=case when p.active_role=p.role_order[1] then 'active' else 'completed' end,
      updated_at=now_at where id=p.id;
  end if;
  return jsonb_build_object('skipped',true,'role_complete',remaining=0);
end; $$;
revoke all on function public.study_skip_timed_out(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.study_skip_timed_out(uuid,uuid,uuid) to service_role;
commit;
