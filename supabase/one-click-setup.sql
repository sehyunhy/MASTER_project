-- ONE-CLICK SUPABASE SETUP
-- Paste this complete file into Supabase Dashboard > SQL Editor and run once.
-- Safe to rerun: existing participant assignments and unrelated product rows are preserved.
-- Creates schema, four researcher-defined profiles, and missing participant slots.
-- Walmart rows are imported separately after an approved fixed exchange rate is supplied.

-- ===== 0001_initial.sql =====
create extension if not exists pgcrypto;

create table if not exists experiment_sequences (
  id text primary key, sequence_name text not null unique,
  position_1 text not null, position_2 text not null, position_3 text not null, position_4 text not null,
  version text not null default 'williams-v1'
);
create table if not exists participants (
  id uuid primary key default gen_random_uuid(), participant_code text not null unique,
  role text not null check (role in ('giver','recipient')),
  intimacy_condition text not null check (intimacy_condition in ('high','low')),
  sequence_id text not null references experiment_sequences(id),
  status text not null default 'assigned' check (status in ('assigned','started','active','completed','withdrawn')),
  experiment_version text not null default '1.0.0',
  started_at timestamptz, completed_at timestamptz, training_attempts integer not null default 0,
  is_mock boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists recipient_profiles (
  id text primary key, profile_code text not null unique, name text not null, age integer not null, occupation text not null,
  hobbies jsonb not null, recent_interest text not null, preference text not null, dislike text not null,
  lifestyle_context text not null, gift_budget integer not null, gift_occasion text not null, version text not null default 'profiles-v1'
);
create table if not exists trials (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references participants(id) on delete cascade,
  trial_number integer not null check (trial_number between 1 and 4), profile_id text not null references recipient_profiles(id),
  condition_id text not null check (condition_id in ('C1','C2','C3','C4')),
  execution_autonomy text not null check (execution_autonomy in ('human_guided','agent_autonomous')),
  decision_authority text not null check (decision_authority in ('human','agent')),
  status text not null default 'pending' check (status in ('pending','active','awaiting_survey','completed')),
  experiment_version text not null default '1.0.0', ui_version text not null default '1.0.0',
  profile_version text not null default 'profiles-v1', candidate_version text not null default 'candidates-v1',
  prompt_version text not null default 'gift-prompt-v1', sequence_version text not null default 'williams-v1',
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), is_mock boolean not null default false,
  unique (participant_id, trial_number), unique (participant_id, condition_id)
);
create table if not exists guided_responses (
  id uuid primary key default gen_random_uuid(), trial_id uuid not null references trials(id) on delete cascade,
  question_id text not null, question_text text not null, answer_value text not null, shown_at timestamptz not null, answered_at timestamptz not null,
  response_time_ms integer not null check (response_time_ms >= 0), is_mock boolean not null default false, unique(trial_id, question_id)
);
create table if not exists gift_candidates (
  id uuid primary key default gen_random_uuid(), profile_id text not null references recipient_profiles(id), candidate_set_id text not null,
  product_name text not null, category text not null, price integer not null, description text not null, fit_reason text not null,
  preference_score numeric(2,1) not null, practicality_score numeric(2,1) not null, budget_score numeric(2,1) not null, overall_score numeric(2,1) not null,
  image_url text, is_mock boolean not null default false, version text not null default 'candidates-v1',
  unique(profile_id, candidate_set_id, product_name)
);
create table if not exists trial_candidates (
  id uuid primary key default gen_random_uuid(), trial_id uuid not null references trials(id) on delete cascade,
  gift_candidate_id uuid not null references gift_candidates(id), display_order integer not null check (display_order between 1 and 3),
  is_mock boolean not null default false,
  unique(trial_id, gift_candidate_id), unique(trial_id, display_order)
);
create table if not exists final_selections (
  id uuid primary key default gen_random_uuid(), trial_id uuid not null unique references trials(id) on delete cascade,
  selected_candidate_id uuid not null references gift_candidates(id), selected_by text not null check (selected_by in ('human','agent')),
  selected_at timestamptz not null default now(), is_mock boolean not null default false
);
create table if not exists training_attempts (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null references participants(id) on delete cascade,
  attempt_number integer not null, score integer not null, passed boolean not null, responses jsonb not null,
  created_at timestamptz not null default now(), is_mock boolean not null default false, unique(participant_id, attempt_number)
);
create table if not exists event_logs (
  id bigint generated always as identity primary key, participant_id uuid not null references participants(id) on delete cascade,
  trial_id uuid references trials(id) on delete cascade, event_type text not null, payload jsonb not null default '{}',
  created_at timestamptz not null default now(), elapsed_ms integer, experiment_version text not null default '1.0.0', is_mock boolean not null default false,
  role text, trial_number integer, profile_id text, condition_id text, intimacy_condition text, sequence_id text
);
create table if not exists experiment_configs (
  key text primary key, value jsonb not null, version text not null default '1.0.0', updated_at timestamptz not null default now()
);
create index if not exists idx_trials_participant on trials(participant_id, trial_number);
create index if not exists idx_events_participant on event_logs(participant_id, created_at);
create index if not exists idx_candidates_profile on gift_candidates(profile_id, candidate_set_id);

insert into experiment_sequences (id, sequence_name, position_1, position_2, position_3, position_4) values
('S1','S1','C1','C2','C4','C3'), ('S2','S2','C2','C3','C1','C4'),
('S3','S3','C3','C4','C2','C1'), ('S4','S4','C4','C1','C3','C2') on conflict (id) do nothing;

alter table participants enable row level security;
alter table experiment_sequences enable row level security;
alter table recipient_profiles enable row level security;
alter table trials enable row level security;
alter table guided_responses enable row level security;
alter table gift_candidates enable row level security;
alter table trial_candidates enable row level security;
alter table final_selections enable row level security;
alter table training_attempts enable row level security;
alter table event_logs enable row level security;
alter table experiment_configs enable row level security;
-- No anon policies: browser reads/writes go through validated server routes using the service role key.


-- ===== 0002_behavioral_logging.sql =====
alter table event_logs add column if not exists event_target text;
alter table event_logs add column if not exists event_value text;
alter table event_logs add column if not exists client_timestamp timestamptz;
alter table event_logs add column if not exists server_timestamp timestamptz not null default now();
alter table event_logs add column if not exists elapsed_from_trial_start_ms integer;
alter table event_logs add column if not exists execution_autonomy text;
alter table event_logs add column if not exists decision_authority text;
alter table event_logs add column if not exists payload_json jsonb not null default '{}';

update event_logs set server_timestamp=created_at where server_timestamp is null;
update event_logs set payload_json=payload where payload_json='{}'::jsonb and payload is not null;

alter table guided_responses add column if not exists confirmed_at timestamptz;
alter table guided_responses add column if not exists revision_count integer not null default 0 check (revision_count >= 0);

create index if not exists idx_event_logs_trial_type_time on event_logs(trial_id,event_type,server_timestamp);
create index if not exists idx_event_logs_client_time on event_logs(trial_id,client_timestamp);


-- ===== 0003_product_catalog.sql =====
create table if not exists product_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  product_name text not null,
  category text not null,
  price integer not null check (price >= 0),
  description text not null,
  image_url text,
  source text not null default 'synthetic_qa',
  version text not null default 'product-catalog-v1',
  is_mock boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_catalog_category on product_catalog(category);
create index if not exists idx_product_catalog_active_price on product_catalog(is_active, price);

alter table product_catalog enable row level security;
-- No anon policies: catalog access goes through server routes/service-role scripts.


-- ===== 0004_agent_workflow.sql =====
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
    threshold_met_at=case when accumulated_ms>=20000 then coalesce(threshold_met_at,v_now) else threshold_met_at end,
    active_tab_id=p_tab_id, lease_until=v_now+interval '12 seconds', paused_at=null, updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase;
  return jsonb_build_object('ready',true,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=20000,'server_now',v_now);
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
    return jsonb_build_object('accepted',false,'reason','stale_sequence','accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=20000);
  end if;
  if v_row.lease_until > v_now and v_row.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  if v_row.paused_at is null and v_row.last_heartbeat_at is not null then
    v_delta := greatest(0, floor(extract(epoch from (v_now-v_row.last_heartbeat_at))*1000)::integer);
    -- A delayed/offline heartbeat never credits the missing interval.
    if v_delta > 5000 then v_delta := 0; end if;
  end if;
  update public.trial_phase_exposures set
    accumulated_ms=accumulated_ms+v_delta,
    threshold_met_at=case when v_row.accumulated_ms+v_delta>=20000 then coalesce(v_row.threshold_met_at,v_now) else v_row.threshold_met_at end,
    last_heartbeat_at=case when p_active then v_now else null end,
    last_sequence=p_sequence, active_tab_id=p_tab_id,
    lease_until=case when p_active then v_now+interval '12 seconds' else v_now+interval '12 seconds' end,
    paused_at=case when p_active then null else coalesce(paused_at,v_now) end, updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase returning * into v_row;
  return jsonb_build_object('accepted',true,'delta_ms',v_delta,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=20000,'server_now',v_now);
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
  if not found or v_exposure.accumulated_ms < 20000 then raise exception 'MIN_EXPOSURE_NOT_MET'; end if;
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


-- Seed the four stable, fictional recipient profiles used by the trials.
insert into public.recipient_profiles
(id,profile_code,name,age,occupation,hobbies,recent_interest,preference,dislike,lifestyle_context,gift_budget,gift_occasion,version)
values
('R1','R1','민서',29,'서비스 기획자','["러닝","웰니스"]'::jsonb,'운동 기록 관리와 꾸준한 활동 루틴에 관심이 있습니다.','일상에서 부담 없이 사용할 수 있는 물건을 선호합니다.','관리 과정이 복잡한 제품은 선호하지 않습니다.','평일에는 도심에서 생활하고 주말에는 야외 활동을 즐깁니다.',50000,'생일','profiles-v1'),
('R2','R2','지훈',31,'편집자','["커피","독서"]'::jsonb,'집에서 커피를 즐기는 방법과 새로운 책에 관심이 있습니다.','공간을 많이 차지하지 않고 오래 쓸 수 있는 물건을 선호합니다.','향이 지나치게 강한 제품은 선호하지 않습니다.','집에서 보내는 시간이 많고 조용한 여가를 즐깁니다.',50000,'감사 선물','profiles-v1'),
('R3','R3','서연',27,'마케터','["여행","사진"]'::jsonb,'가까운 곳을 천천히 둘러보며 사진으로 기록하는 데 관심이 있습니다.','휴대하기 쉽고 여러 상황에서 활용할 수 있는 물건을 선호합니다.','무게가 많이 나가는 물건은 선호하지 않습니다.','주말마다 근교를 방문하고 새로운 장소를 기록합니다.',50000,'생일','profiles-v1'),
('R4','R4','도윤',30,'연구원','["요리","홈 라이프"]'::jsonb,'집에서 간단한 요리를 만들고 식탁을 꾸미는 데 관심이 있습니다.','실용적이면서 디자인이 단정한 물건을 선호합니다.','보관과 세척이 번거로운 제품은 선호하지 않습니다.','평일 저녁과 주말에 집에서 식사를 준비합니다.',50000,'감사 선물','profiles-v1')
on conflict (id) do nothing;


-- Create missing assignment slots only. Existing participant assignments are never overwritten.
with roles(role,code_offset) as (values ('giver',0),('recipient',40)),
nums as (select generate_series(1,40) as n),
slots as (select roles.role,roles.code_offset,nums.n,case when nums.n<=20 then 'high' else 'low' end as intimacy,
  case when nums.n<=20 then nums.n-1 else nums.n-21 end as within_cell
  from roles cross join nums)
insert into public.participants(participant_code,role,intimacy_condition,sequence_id,profile_rotation_offset,status,experiment_version,is_mock)
select 'P'||lpad((n+code_offset)::text,3,'0'),role,intimacy,
  'S'||(floor((within_cell::numeric)/5)::integer+1)::text,
  (case when mod(within_cell,5)<4 then mod(within_cell,5) when intimacy='high' then 0 else 1 end)::smallint,
  'assigned','2.0.0',false
from slots on conflict(participant_code) do nothing;


-- ===== 0005_walmart_chat_observation.sql =====
-- Apply after 0001-0004. No existing observations or assignments are deleted.
alter table public.product_catalog add column if not exists source_product_id text;
alter table public.product_catalog add column if not exists product_name_original text;
alter table public.product_catalog add column if not exists product_name_ko text;
alter table public.product_catalog add column if not exists description_original text;
alter table public.product_catalog add column if not exists description_ko text;
alter table public.product_catalog add column if not exists price_original numeric(14,4);
alter table public.product_catalog add column if not exists currency_original text;
alter table public.product_catalog add column if not exists price_experiment numeric(14,2);
alter table public.product_catalog add column if not exists currency_experiment text;
alter table public.product_catalog add column if not exists fx_rate_version text;
alter table public.product_catalog add column if not exists source_timestamp timestamptz;
alter table public.product_catalog add column if not exists source_timestamp_raw text;
alter table public.product_catalog add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.product_catalog add column if not exists categories jsonb not null default '[]'::jsonb;
alter table public.product_catalog add column if not exists search_tags_ko text[] not null default '{}';
alter table public.product_catalog add column if not exists raw_record jsonb not null default '{}'::jsonb;
alter table public.product_catalog add column if not exists import_issues text[] not null default '{}';
alter table public.product_catalog add column if not exists experiment_eligible boolean not null default false;
alter table public.product_catalog add column if not exists review_status text not null default 'unreviewed';
create unique index if not exists product_catalog_source_id_unique on public.product_catalog(dataset_version,source_product_id) where source_product_id is not null;
create index if not exists product_catalog_experiment_search on public.product_catalog(dataset_version,experiment_eligible,is_active,price);
create index if not exists product_catalog_profile_codes on public.product_catalog using gin(profile_codes);
create index if not exists product_catalog_search_tags on public.product_catalog using gin(search_tags_ko);

create table if not exists public.trial_search_states (
  trial_id uuid primary key references public.trials(id) on delete cascade,
  scenario_id text not null,
  recipient_context text not null default '',
  allowed_categories text[] not null default '{}',
  selected_category text,
  preference_tags text[] not null default '{}',
  use_context text,
  selection_priorities text[] not null default '{}',
  excluded_features text[] not null default '{}',
  budget_limit integer not null check (budget_limit >= 0),
  currency text not null default 'KRW',
  query_text text not null default '',
  state_version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.trial_search_states enable row level security;

alter table public.trials add column if not exists stimulus_version integer not null default 1;
alter table public.trials add column if not exists stimulus_source text not null default 'researcher_scripted';
alter table public.trials add column if not exists stimulus_id text;
alter table public.trials add column if not exists candidate_set_hash text;
alter table public.trials add column if not exists final_product_source_id text;
alter table public.trial_messages add column if not exists event_origin text not null default 'participant';
alter table public.trial_messages add column if not exists transcript_id text;
alter table public.trial_messages add column if not exists stimulus_version integer;
alter table public.event_logs add column if not exists event_origin text not null default 'participant';
alter table public.event_logs add column if not exists transcript_id text;
alter table public.event_logs add column if not exists stimulus_version integer;
alter table public.event_logs add column if not exists input_mode text;
alter table public.event_logs add column if not exists intent text;

create table if not exists public.recipient_stimuli (
  id text primary key,
  scenario_id text not null,
  profile_code text not null,
  version integer not null,
  source_kind text not null check (source_kind in ('researcher_scripted','recorded')),
  source_note text not null,
  candidate_snapshots jsonb not null,
  final_source_product_id text not null,
  transcript jsonb not null,
  candidate_set_hash text not null,
  review_status text not null default 'pending',
  frozen_at timestamptz,
  unique(scenario_id,version)
);
alter table public.recipient_stimuli enable row level security;

-- A reviewed observation cannot silently change for later conditions. Add a new version instead.
create or replace function public.guard_frozen_recipient_stimulus()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' and old.review_status='approved' then
    raise exception 'FROZEN_STIMULUS_IMMUTABLE';
  end if;
  if tg_op='UPDATE' and old.review_status='approved' then
    raise exception 'FROZEN_STIMULUS_IMMUTABLE';
  end if;
  if tg_op='UPDATE' and new.review_status='approved' and new.frozen_at is null then
    raise exception 'FROZEN_AT_REQUIRED';
  end if;
  if tg_op='INSERT' and new.review_status='approved' and new.frozen_at is null then
    raise exception 'FROZEN_AT_REQUIRED';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
drop trigger if exists recipient_stimulus_frozen_guard on public.recipient_stimuli;
create trigger recipient_stimulus_frozen_guard before insert or update or delete on public.recipient_stimuli
for each row execute function public.guard_frozen_recipient_stimulus();

create table if not exists public.training_practice_checks (
  participant_id uuid not null references public.participants(id) on delete cascade,
  scenario_index smallint not null check (scenario_index in (0,1)),
  comparison_answer text not null,
  decision_answer text not null,
  passed boolean not null,
  attempts integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(participant_id,scenario_index)
);
alter table public.training_practice_checks enable row level security;

-- Existing started sessions retain their version; unstarted canonical slots use v3.
update public.participants set experiment_version='3.0.0'
where status='assigned' and started_at is null and experiment_version='2.0.0'
  and not exists(select 1 from public.trials t where t.participant_id=participants.id);
alter table public.participants alter column experiment_version set default '3.0.0';
alter table public.trials alter column experiment_version set default '3.0.0';
alter table public.trials alter column dataset_version set default 'walmart-2024-08-v1';

-- Do not count a heartbeat that reports the tab is hidden or offline.
create or replace function public.phase_heartbeat(p_trial_id uuid, p_phase text, p_tab_id text, p_sequence bigint, p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_now timestamptz := clock_timestamp(); v_trial public.trials%rowtype; v_row public.trial_phase_exposures%rowtype; v_delta integer := 0;
begin
  select * into v_trial from public.trials where id=p_trial_id for update;
  if not found or v_trial.current_phase <> p_phase then raise exception 'PHASE_MISMATCH'; end if;
  select * into v_row from public.trial_phase_exposures where trial_id=p_trial_id and phase=p_phase for update;
  if not found or v_row.content_ready_at is null then raise exception 'CONTENT_NOT_READY'; end if;
  if p_sequence <= v_row.last_sequence then return jsonb_build_object('accepted',false,'reason','stale_sequence','accumulated_ms',v_row.accumulated_ms); end if;
  if v_row.lease_until > v_now and v_row.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  if p_active and v_row.paused_at is null and v_row.last_heartbeat_at is not null then
    v_delta := greatest(0, floor(extract(epoch from (v_now-v_row.last_heartbeat_at))*1000)::integer);
    if v_delta > 5000 then v_delta := 0; end if;
  end if;
  update public.trial_phase_exposures set accumulated_ms=accumulated_ms+v_delta,
    threshold_met_at=case when v_row.accumulated_ms+v_delta>=20000 then coalesce(v_row.threshold_met_at,v_now) else v_row.threshold_met_at end,
    last_heartbeat_at=case when p_active then v_now else null end,
    last_sequence=p_sequence,active_tab_id=p_tab_id,lease_until=v_now+interval '12 seconds',
    paused_at=case when p_active then null else coalesce(paused_at,v_now) end,updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase returning * into v_row;
  return jsonb_build_object('accepted',true,'delta_ms',v_delta,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=20000);
end; $$;
revoke all on function public.phase_heartbeat(uuid,text,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.phase_heartbeat(uuid,text,text,bigint,boolean) to service_role;
