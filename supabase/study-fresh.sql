-- New study only. Run in Supabase SQL Editor when ready to erase ALL prior
-- participant, stimulus, event and product rows. This does not migrate
-- or import any old DB records. Products are collected by live search.
-- A failed statement rolls back the complete reset.
begin;
create extension if not exists pgcrypto;

drop table if exists public.study_events,public.study_messages,public.study_stimuli,
  public.study_trials,public.study_people,public.study_products cascade;
drop table if exists public.v6_selection_reason_history,public.v6_candidate_requests,
  public.v6_phase_records,public.v6_transition_attempts,public.v6_transition_code_slots,
  public.v6_stimuli,public.v5_surveys,public.v5_phase_records,
  public.v5_transition_attempts,public.v5_transition_code_slots,public.v5_stimuli,
  public.role_sessions,public.research_subjects,public.training_practice_checks,
  public.training_attempts,public.event_logs,public.trial_messages,
  public.trial_phase_exposures,public.trial_search_states,public.final_selections,
  public.trial_candidates,public.guided_responses,public.trials,
  public.gift_candidates,public.recipient_stimuli,public.participants,
  public.recipient_profiles,public.experiment_sequences,public.experiment_configs,
  public.product_catalog cascade;
-- Functions are separate schema objects and can survive a table reset when
-- their PL/pgSQL bodies referenced old tables only by name.
do $$
declare item record;
begin
  for item in select p.proname,p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'advance_trial_phase','finalize_trial_selection','guard_frozen_recipient_stimulus',
      'phase_content_ready','phase_heartbeat','v6_advance_phase','v6_complete_role_session',
      'v6_confirm_candidate','v6_confirm_trial_intro','v6_enroll_subject','v6_finalize_selection',
      'v6_phase_heartbeat','v6_phase_ready','v6_verify_transition_code',
      'study_activate','study_advance','study_assign_participant_number','study_attach_stimulus','study_claim_agent',
      'study_begin_new_person','study_confirm_candidate','study_enroll','study_finalize','study_finish_survey',
      'study_skip_timed_out',
      'study_mark_candidates_visible','study_ping','study_release_agent',
      'study_store_batch','study_store_proposal'])
  loop
    execute format('drop function if exists public.%I(%s) cascade',
      item.proname,pg_get_function_identity_arguments(item.oid));
  end loop;
end; $$;

create table public.study_people (
  id uuid primary key default gen_random_uuid(),
  participant_number text not null unique,
  giver_number text not null unique,
  recipient_number text not null unique,
  enrollment_number bigint generated always as identity unique,
  browser_key uuid not null unique,
  first_role text not null check(first_role in ('giver','recipient')),
  active_role text not null check(active_role in ('giver','recipient','done')),
  role_order text[] not null,
  condition_order text[] not null,
  order_index smallint not null check(order_index between 0 and 3),
  enrollment_block bigint not null,
  profile_code text not null,
  status text not null default 'active' check(status in ('active','completed','withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint study_people_participant_number_format
    check(participant_number ~ '^K[0-9]{2,8}$'),
  constraint study_people_pair_format
    check(giver_number ~ '^K[0-9]{2,8}$' and recipient_number ~ '^K[0-9]{2,8}$'
      and substring(giver_number from 2)::bigint=substring(recipient_number from 2)::bigint+1
      and participant_number in (giver_number,recipient_number))
);

create table public.study_products (
  source_product_id text primary key,
  dataset_version text not null,
  profile_codes text[] not null,
  name_original text not null,
  name_ko text not null,
  description_original text not null,
  image_url text not null,
  category text not null,
  price_original_usd numeric(12,2) not null check(price_original_usd>=0),
  price_krw integer not null check(price_krw between 0 and 50000),
  fx_rule text not null,
  source_url text,
  reviewed boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);

create table public.study_stimuli (
  id uuid primary key default gen_random_uuid(),
  profile_code text not null,
  condition text not null check(condition in ('A','B','C','D')),
  stimulus_version text not null,
  origin text not null default 'scripted' check(origin='scripted'),
  transcript jsonb not null check(jsonb_typeof(transcript)='array'),
  candidate_snapshots jsonb not null check(jsonb_typeof(candidate_snapshots)='array' and jsonb_array_length(candidate_snapshots)=3),
  final_product_id text not null references public.study_products(source_product_id),
  approved_at timestamptz,
  approved_by text,
  unique(profile_code,condition,stimulus_version)
);

create table public.study_trials (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.study_people(id) on delete cascade,
  participant_number text not null,
  role text not null check(role in ('giver','recipient')),
  order_position smallint not null check(order_position between 1 and 4),
  condition text not null check(condition in ('A','B','C','D')),
  candidate_builder text not null check(candidate_builder in ('human','agent')),
  decision_actor text not null check(decision_actor in ('human','agent')),
  profile_code text not null,
  stimulus_version_target text not null default 'birthday-friend-a-web-v2',
  phase text not null default 'locked' check(phase in ('locked','candidates','decision','survey','complete','timeout','skipped')),
  phase_started_at timestamptz,
  phase_effective_ms integer not null default 0 check(phase_effective_ms between 0 and 180000),
  phase_last_ping_at timestamptz,
  phase_ping_sequence bigint not null default -1,
  active_tab_id text,
  active_tab_lease_until timestamptz,
  candidates_effective_ms integer,
  candidates_ended_at timestamptz,
  decision_effective_ms integer,
  decision_ended_at timestamptz,
  candidate_snapshots jsonb not null default '[]'::jsonb check(jsonb_typeof(candidate_snapshots)='array' and jsonb_array_length(candidate_snapshots)<=3),
  candidates_visible_at timestamptz,
  proposal jsonb,
  operation_key uuid,
  operation_kind text,
  operation_started_at timestamptz,
  final_product_id text,
  final_reason text,
  final_actor text check(final_actor is null or final_actor in ('human','agent')),
  final_at timestamptz,
  survey_completed_at timestamptz,
  timed_out_at timestamptz,
  timeout_phase text,
  skipped_at timestamptz,
  operator_review_needed boolean not null default false,
  stimulus_id uuid references public.study_stimuli(id),
  revision integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(person_id,role,order_position),unique(person_id,role,condition),
  check(final_product_id is null or jsonb_path_exists(candidate_snapshots,'$[*] ? (@.source_product_id == $pid)',jsonb_build_object('pid',final_product_id)))
);

create table public.study_messages (
  id bigint generated always as identity primary key,
  trial_id uuid not null references public.study_trials(id) on delete cascade,
  participant_number text not null,
  phase text not null,
  speaker text not null check(speaker in ('participant','agent','scripted_giver','system')),
  origin text not null check(origin in ('participant','agent','scripted','system')),
  kind text not null,
  content text not null default '',
  payload jsonb not null default '{}'::jsonb,
  request_key uuid,
  server_at timestamptz not null default clock_timestamp(),
  unique(trial_id,request_key)
);

create table public.study_events (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.study_people(id) on delete cascade,
  participant_number text not null,
  trial_id uuid references public.study_trials(id) on delete cascade,
  role text,
  condition text,
  order_position smallint,
  phase text,
  actor text not null check(actor in ('participant','agent','scripted_giver','system')),
  origin text not null check(origin in ('participant','agent','scripted','system')),
  event_type text not null,
  target text,
  payload jsonb not null default '{}'::jsonb,
  client_at timestamptz,
  server_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid,
  experiment_version text not null default '7.1.0'
);
create unique index study_events_trial_key on public.study_events(trial_id,idempotency_key);
create unique index study_scripted_message_once on public.study_events(trial_id,event_type,target)
  where event_type='scripted_message_shown';
create index study_events_timeline on public.study_events(trial_id,server_at,id);
create index study_messages_timeline on public.study_messages(trial_id,id);
create index study_trials_person on public.study_trials(person_id,role,order_position);
create index study_trials_participant_number on public.study_trials(participant_number,role,order_position);
create index study_messages_participant_number on public.study_messages(participant_number,id);
create index study_events_participant_number on public.study_events(participant_number,server_at,id);
create index study_products_profiles on public.study_products using gin(profile_codes);

alter table public.study_people enable row level security;
alter table public.study_trials enable row level security;
alter table public.study_products enable row level security;
alter table public.study_stimuli enable row level security;
alter table public.study_messages enable row level security;
alter table public.study_events enable row level security;
-- No browser grants. The application validates its signed session and uses
-- the server-only service role key.

create function public.study_assign_participant_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='study_trials' then
    select case when new.role='giver' then coalesce(p.giver_number,p.participant_number) else coalesce(p.recipient_number,p.participant_number) end
      into new.participant_number from public.study_people p where p.id=new.person_id;
  elsif tg_table_name='study_messages' then
    new.participant_number := (select participant_number from public.study_trials where id=new.trial_id);
  elsif tg_table_name='study_events' then
    select case when new.role='giver' then coalesce(p.giver_number,p.participant_number)
                when new.role='recipient' then coalesce(p.recipient_number,p.participant_number)
                else p.participant_number end
      into new.participant_number from public.study_people p where p.id=new.person_id;
  end if;
  if new.participant_number is null then raise exception 'PARTICIPANT_NUMBER_MISSING'; end if;
  return new;
end; $$;
create trigger study_trials_participant_number before insert or update on public.study_trials
  for each row execute function public.study_assign_participant_number();
create trigger study_messages_participant_number before insert or update on public.study_messages
  for each row execute function public.study_assign_participant_number();
create trigger study_events_participant_number before insert or update on public.study_events
  for each row execute function public.study_assign_participant_number();

create function public.study_enroll(p_role text,p_browser_key uuid,p_participant_number text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.study_people%rowtype; block_index bigint; within_block integer; sequence_index integer;
  sequence_value text[]; role_name text; item text; pos integer;
  entered_number bigint; recipient_code text; giver_code text; expected_code text;
begin
  p_participant_number:=upper(trim(p_participant_number));
  if p_role not in ('giver','recipient') or p_browser_key is null
    or p_participant_number is null or p_participant_number !~ '^K[0-9]{2,8}$'
    then raise exception 'INVALID_ENROLLMENT'; end if;
  entered_number:=substring(p_participant_number from 2)::bigint;
  if entered_number<1 or p_participant_number<>('K'||lpad(entered_number::text,2,'0'))
    or (p_role='giver' and entered_number%2<>0)
    or (p_role='recipient' and entered_number%2<>1)
    then raise exception 'INVALID_ENROLLMENT'; end if;
  recipient_code:='K'||lpad((case when p_role='giver' then entered_number-1 else entered_number end)::text,2,'0');
  giver_code:='K'||lpad((case when p_role='giver' then entered_number else entered_number+1 end)::text,2,'0');
  if length(giver_code)>9 then raise exception 'INVALID_ENROLLMENT'; end if;
  perform pg_advisory_xact_lock(hashtext('study-enrollment'));
  select * into p from public.study_people where browser_key=p_browser_key;
  if found then
    expected_code:=case when p_role='giver' then p.giver_number else p.recipient_number end;
    if expected_code is distinct from p_participant_number then raise exception 'PARTICIPANT_NUMBER_MISMATCH'; end if;
    return jsonb_build_object('person_id',p.id,'participant_number',p.participant_number,
      'enrollment_number',p.enrollment_number,'active_role',p.active_role);
  end if;
  if exists(select 1 from public.study_people where giver_number=giver_code or recipient_number=recipient_code or participant_number in (giver_code,recipient_code))
    then raise exception 'PARTICIPANT_NUMBER_TAKEN'; end if;
  insert into public.study_people(participant_number,giver_number,recipient_number,browser_key,first_role,active_role,role_order,
    condition_order,order_index,enrollment_block,profile_code)
  values(p_participant_number,giver_code,recipient_code,p_browser_key,p_role,p_role,array[p_role,case when p_role='giver' then 'recipient' else 'giver' end],
    array['A','C','D','B'],0,1,'R1') returning * into p;
  block_index:=(p.enrollment_number-1)/5;
  within_block:=((p.enrollment_number-1)%5)::integer;
  sequence_index:=((block_index+case when within_block=4 then 0 else within_block end)%4)::integer;
  sequence_value:=case sequence_index
    when 0 then array['A','C','D','B']
    when 1 then array['C','B','A','D']
    when 2 then array['B','D','C','A']
    else array['D','A','B','C'] end;
  update public.study_people set condition_order=sequence_value,order_index=sequence_index,
    enrollment_block=block_index+1,profile_code='R'||(((p.enrollment_number-1)%4)+1)::text
    where id=p.id returning * into p;
  foreach role_name in array p.role_order loop
    for pos in 1..4 loop
      item:=sequence_value[pos];
      insert into public.study_trials(person_id,role,order_position,condition,candidate_builder,decision_actor,profile_code,stimulus_version_target)
      values(p.id,role_name,pos,item,
        case when item in ('A','C') then 'human' else 'agent' end,
        case when item in ('A','B') then 'human' else 'agent' end,p.profile_code,'birthday-friend-a-web-v2');
    end loop;
  end loop;
  insert into public.study_events(person_id,role,actor,origin,event_type,payload)
  values(p.id,p_role,'system','system','enrolled',jsonb_build_object('block',p.enrollment_block,'order',p.condition_order));
  return jsonb_build_object('person_id',p.id,'participant_number',p.participant_number,
    'enrollment_number',p.enrollment_number,'active_role',p.active_role);
end; $$;

create function public.study_begin_new_person(p_previous_id uuid,p_role text,p_browser_key uuid,p_participant_number text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.study_people%rowtype; enrolled jsonb; next_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if p_role not in ('giver','recipient') or p_browser_key is null then raise exception 'INVALID_ENROLLMENT'; end if;
  if p_previous_id is not null then
    select * into previous from public.study_people where id=p_previous_id for update;
  end if;
  enrolled:=public.study_enroll(p_role,p_browser_key,p_participant_number);
  next_id:=(enrolled->>'person_id')::uuid;
  if previous.id is not null and previous.id<>next_id and previous.status='active' then
    update public.study_people set status='withdrawn',updated_at=now_at where id=previous.id;
    insert into public.study_events(person_id,role,actor,origin,event_type,payload)
    values(previous.id,previous.active_role,'system','system','previous_session_ended_for_new_person',
      jsonb_build_object('new_person_id',next_id,'unfinished_trials_preserved',true));
  end if;
  return enrolled;
end; $$;

create function public.study_activate(p_person_id uuid,p_trial_id uuid,p_code text,p_attempt_key uuid)
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

create function public.study_ping(p_trial_id uuid,p_tab_id text,p_sequence bigint,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp(); delta_ms integer:=0; total integer;
begin
  select * into t from public.study_trials where id=p_trial_id for update;
  if t.id is null or t.phase not in ('candidates','decision') then raise exception 'PHASE_NOT_ACTIVE'; end if;
  if t.phase='candidates' and t.candidate_builder='agent' and t.candidates_visible_at is null then
    return jsonb_build_object('accepted',true,'effective_ms',0,'phase',t.phase,'waiting_for_candidates',true);
  end if;
  if p_sequence<=t.phase_ping_sequence then return jsonb_build_object('accepted',false,'effective_ms',t.phase_effective_ms,'phase',t.phase); end if;
  if t.active_tab_lease_until>now_at and t.active_tab_id is distinct from p_tab_id then raise exception 'OTHER_TAB_ACTIVE'; end if;
  if p_active and t.phase_last_ping_at is not null and t.active_tab_id=p_tab_id then
    delta_ms:=greatest(0,floor(extract(epoch from(now_at-t.phase_last_ping_at))*1000)::integer);
    if delta_ms>5000 then delta_ms:=0; end if;
  end if;
  total:=least(180000,t.phase_effective_ms+delta_ms);
  update public.study_trials set
    phase_started_at=case when p_active then coalesce(phase_started_at,now_at) else phase_started_at end,
    phase_effective_ms=total,phase_last_ping_at=case when p_active then now_at else null end,
    phase_ping_sequence=p_sequence,active_tab_id=case when p_active then p_tab_id else null end,
    active_tab_lease_until=case when p_active then now_at+interval '12 seconds' else null end,
    phase=case when total>=180000 then 'timeout' else phase end,
    timed_out_at=case when total>=180000 then now_at else timed_out_at end,
    timeout_phase=case when total>=180000 then phase else timeout_phase end,
    operator_review_needed=case when total>=180000 then true else operator_review_needed end,
    updated_at=now_at where id=t.id;
  if total>=180000 then
    insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload)
    values(t.person_id,t.id,t.role,t.condition,t.order_position,t.phase,'system','system','phase_timeout',
      jsonb_build_object('effective_ms',total,'missing_candidate_count',3-jsonb_array_length(t.candidate_snapshots),'has_final',t.final_product_id is not null));
  end if;
  return jsonb_build_object('accepted',true,'effective_ms',total,'phase',case when total>=180000 then 'timeout' else t.phase end);
end; $$;

create function public.study_mark_candidates_visible(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.phase<>'candidates' or t.candidate_builder<>'agent'
    or jsonb_array_length(t.candidate_snapshots)<>3 then raise exception 'CANDIDATES_NOT_READY'; end if;
  if t.candidates_visible_at is null then
    update public.study_trials set candidates_visible_at=now_at,phase_started_at=now_at,
      phase_last_ping_at=null,phase_effective_ms=0,phase_ping_sequence=-1 where id=t.id;
    insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type)
    values(t.person_id,t.id,t.role,t.condition,t.order_position,'candidates','participant','participant','candidate_set_visible');
  end if;
  return jsonb_build_object('visible_at',coalesce(t.candidates_visible_at,now_at));
end; $$;

create function public.study_advance(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp(); next_phase text;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.phase not in ('candidates','decision') then raise exception 'PHASE_NOT_ACTIVE'; end if;
  if t.phase_effective_ms<30000 then raise exception 'MINIMUM_EXPOSURE_REQUIRED'; end if;
  if t.phase='candidates' then
    if jsonb_array_length(t.candidate_snapshots)<>3 then raise exception 'THREE_CANDIDATES_REQUIRED'; end if;
    next_phase:='decision';
    update public.study_trials set candidates_effective_ms=phase_effective_ms,candidates_ended_at=now_at,
      phase='decision',phase_started_at=null,phase_effective_ms=0,phase_last_ping_at=null,
      phase_ping_sequence=-1,active_tab_id=null,active_tab_lease_until=null,updated_at=now_at where id=t.id;
  else
    if t.final_product_id is null then raise exception 'FINAL_SELECTION_REQUIRED'; end if;
    next_phase:='survey';
    update public.study_trials set decision_effective_ms=phase_effective_ms,decision_ended_at=now_at,
      phase='survey',phase_last_ping_at=null,active_tab_id=null,active_tab_lease_until=null,updated_at=now_at where id=t.id;
  end if;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,t.phase,'participant','participant','phase_advanced',jsonb_build_object('to',next_phase,'effective_ms',t.phase_effective_ms));
  return jsonb_build_object('phase',next_phase);
end; $$;

create function public.study_finish_survey(p_trial_id uuid,p_person_id uuid)
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

create function public.study_skip_timed_out(p_trial_id uuid,p_person_id uuid,p_event_key uuid)
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

create function public.study_claim_agent(p_trial_id uuid,p_person_id uuid,p_kind text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'giver' or p_key is null then raise exception 'AGENT_NOT_ALLOWED'; end if;
  if p_kind='one' and (t.phase<>'candidates' or t.candidate_builder<>'human' or jsonb_array_length(t.candidate_snapshots)>=3) then raise exception 'AGENT_NOT_ALLOWED'; end if;
  if p_kind='batch' and (t.phase<>'candidates' or t.candidate_builder<>'agent') then raise exception 'AGENT_NOT_ALLOWED'; end if;
  if p_kind='final' and (t.phase<>'decision' or t.decision_actor<>'agent' or jsonb_array_length(t.candidate_snapshots)<>3) then raise exception 'AGENT_NOT_ALLOWED'; end if;
  if p_kind='one' and t.proposal->>'request_key'=p_key::text then return jsonb_build_object('ready',true); end if;
  if p_kind='batch' and jsonb_array_length(t.candidate_snapshots)=3 then return jsonb_build_object('ready',true); end if;
  if p_kind='final' and t.final_product_id is not null then return jsonb_build_object('ready',true); end if;
  if t.operation_key is not null and t.operation_started_at>clock_timestamp()-interval '90 seconds' then
    return jsonb_build_object('busy',true);
  end if;
  update public.study_trials set operation_key=p_key,operation_kind=p_kind,
    operation_started_at=clock_timestamp() where id=t.id;
  return jsonb_build_object('claimed',true);
end; $$;

create function public.study_release_agent(p_trial_id uuid,p_person_id uuid,p_key uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.study_trials set operation_key=null,operation_kind=null,operation_started_at=null
  where id=p_trial_id and person_id=p_person_id and operation_key=p_key;
end; $$;

create function public.study_store_proposal(p_trial_id uuid,p_person_id uuid,p_request_key uuid,
  p_source_id text,p_reply text,p_reason text,p_model text,p_response_id text,p_latency_ms integer,
  p_evidence_quote text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; product public.study_products%rowtype; snapshot jsonb; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'giver' or t.phase<>'candidates' or t.candidate_builder<>'human'
    or jsonb_array_length(t.candidate_snapshots)>=3 then raise exception 'PROPOSAL_NOT_ALLOWED'; end if;
  if t.proposal->>'request_key'=p_request_key::text then return t.proposal; end if;
  if t.operation_key is distinct from p_request_key or t.operation_kind<>'one' then raise exception 'AGENT_CLAIM_REQUIRED'; end if;
  select * into product from public.study_products where source_product_id=p_source_id
    and reviewed and profile_codes @> array[t.profile_code] and price_krw<=50000;
  if product.source_product_id is null then raise exception 'PRODUCT_OUTSIDE_APPROVED_POOL'; end if;
  if exists(select 1 from jsonb_array_elements(t.candidate_snapshots) item where item->>'source_product_id'=p_source_id)
    then raise exception 'DUPLICATE_PRODUCT'; end if;
  snapshot:=jsonb_build_object('source_product_id',product.source_product_id,'name_ko',product.name_ko,
    'name_original',product.name_original,'description_original',product.description_original,
    'price_krw',product.price_krw,'price_original_usd',product.price_original_usd,
    'image_url',product.image_url,'category',product.category,'source_url',product.source_url,
    'dataset_version',product.dataset_version,'reason',p_reason,'evidence_quote',p_evidence_quote,
    'request_key',p_request_key);
  update public.study_trials set proposal=jsonb_build_object('request_key',p_request_key,'slot',jsonb_array_length(candidate_snapshots)+1,
      'product',snapshot,'reply',p_reply,'model',p_model,'response_id',p_response_id,'latency_ms',p_latency_ms,'proposed_at',now_at),
    operation_key=null,operation_kind=null,operation_started_at=null,revision=revision+1,updated_at=now_at where id=t.id returning * into t;
  insert into public.study_messages(trial_id,phase,speaker,origin,kind,content,payload)
  values(t.id,'candidates','agent','agent','candidate_proposal',p_reply,
    jsonb_build_object('product',snapshot,'request_key',p_request_key,'model',p_model,'response_id',p_response_id,'latency_ms',p_latency_ms,'prompt_version','gift-study-v7.1'));
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'candidates','agent','agent','candidate_proposed',
    jsonb_build_object('source_product_id',p_source_id,'slot',jsonb_array_length(t.candidate_snapshots)+1,'latency_ms',p_latency_ms,'response_id',p_response_id,'model',p_model,'prompt_version','gift-study-v7.1'));
  return t.proposal;
end; $$;

create function public.study_confirm_candidate(p_trial_id uuid,p_person_id uuid,p_request_key uuid,p_event_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; snapshot jsonb; slot integer; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'giver' or t.phase<>'candidates' or t.candidate_builder<>'human' then raise exception 'CANDIDATE_CONFIRM_NOT_ALLOWED'; end if;
  if exists(select 1 from jsonb_array_elements(t.candidate_snapshots) item where item->>'request_key'=p_request_key::text)
    then return jsonb_build_object('confirmed',true,'idempotent',true,'count',jsonb_array_length(t.candidate_snapshots)); end if;
  if t.proposal is null or t.proposal->>'request_key'<>p_request_key::text then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  snapshot:=t.proposal->'product';slot:=jsonb_array_length(t.candidate_snapshots)+1;
  update public.study_trials set candidate_snapshots=candidate_snapshots||jsonb_build_array(snapshot),proposal=null,
    revision=revision+1,updated_at=now_at where id=t.id;
  insert into public.study_messages(trial_id,phase,speaker,origin,kind,content,payload)
  values(t.id,'candidates','participant','participant','candidate_confirmed','후보 '||slot||' 확정',jsonb_build_object('product',snapshot));
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload,idempotency_key)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'candidates','participant','participant','candidate_confirmed',
    jsonb_build_object('source_product_id',snapshot->>'source_product_id','slot',slot),p_event_key) on conflict do nothing;
  return jsonb_build_object('confirmed',true,'count',slot);
end; $$;

create function public.study_store_batch(p_trial_id uuid,p_person_id uuid,p_request_key uuid,p_source_ids text[],
  p_reasons jsonb,p_reply text,p_model text,p_response_id text,p_latency_ms integer,p_evidence_quotes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; snapshots jsonb; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'giver' or t.phase<>'candidates' or t.candidate_builder<>'agent' then raise exception 'BATCH_NOT_ALLOWED'; end if;
  if jsonb_array_length(t.candidate_snapshots)=3 then return jsonb_build_object('idempotent',true,'candidates',t.candidate_snapshots); end if;
  if t.operation_key is distinct from p_request_key or t.operation_kind<>'batch' then raise exception 'AGENT_CLAIM_REQUIRED'; end if;
  if cardinality(p_source_ids)<>3 or (select count(distinct x) from unnest(p_source_ids) x)<>3 then raise exception 'THREE_DISTINCT_PRODUCTS_REQUIRED'; end if;
  select jsonb_agg(jsonb_build_object('source_product_id',p.source_product_id,'name_ko',p.name_ko,
      'name_original',p.name_original,'description_original',p.description_original,'price_krw',p.price_krw,
      'price_original_usd',p.price_original_usd,'image_url',p.image_url,'category',p.category,
      'source_url',p.source_url,'dataset_version',p.dataset_version,'reason',p_reasons->>p.source_product_id,
      'evidence_quote',p_evidence_quotes->>p.source_product_id)
    order by array_position(p_source_ids,p.source_product_id)) into snapshots
  from public.study_products p where p.source_product_id=any(p_source_ids)
    and p.reviewed and p.profile_codes @> array[t.profile_code] and p.price_krw<=50000;
  if snapshots is null or jsonb_array_length(snapshots)<>3 then raise exception 'PRODUCT_OUTSIDE_APPROVED_POOL'; end if;
  update public.study_trials set candidate_snapshots=snapshots,operation_key=null,operation_kind=null,
    operation_started_at=null,revision=revision+1,updated_at=now_at where id=t.id;
  insert into public.study_messages(trial_id,phase,speaker,origin,kind,content,payload)
  values(t.id,'candidates','agent','agent','candidate_batch',p_reply,
    jsonb_build_object('candidates',snapshots,'model',p_model,'response_id',p_response_id,'latency_ms',p_latency_ms,'prompt_version','gift-study-v7.1'));
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'candidates','agent','agent','candidate_batch_ready',
    jsonb_build_object('product_ids',p_source_ids,'latency_ms',p_latency_ms,'response_id',p_response_id,'model',p_model,'prompt_version','gift-study-v7.1'));
  return jsonb_build_object('candidates',snapshots);
end; $$;

create function public.study_finalize(p_trial_id uuid,p_person_id uuid,p_product_id text,
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
      or trim(coalesce(p_reason,'')) ~ '^(그냥|알아서|모르|좋아)'
      or trim(coalesce(p_reason,'')) !~ '(다른|나머지|두 후보|보다|비해|대비|셋 중|세 후보|가장)')
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

create function public.study_attach_stimulus(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; s public.study_stimuli%rowtype; item jsonb;
  source_product public.study_products%rowtype;
  approved_count integer; baseline jsonb; same_count integer;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'recipient' or t.phase<>'candidates' then raise exception 'OBSERVATION_NOT_ALLOWED'; end if;
  if t.stimulus_id is not null then return jsonb_build_object('attached',true,'idempotent',true); end if;
  select * into s from public.study_stimuli where profile_code=t.profile_code and condition=t.condition
    and stimulus_version=t.stimulus_version_target
    and approved_at is not null order by approved_at desc limit 1;
  if s.id is null then raise exception 'APPROVED_STIMULUS_MISSING'; end if;
  select count(*),min(candidate_snapshots::text)::jsonb into approved_count,baseline
    from public.study_stimuli where profile_code=t.profile_code and stimulus_version=s.stimulus_version and approved_at is not null;
  select count(*) into same_count from public.study_stimuli
    where profile_code=t.profile_code and stimulus_version=s.stimulus_version and approved_at is not null
      and candidate_snapshots=baseline and final_product_id=s.final_product_id;
  if approved_count<>4 or same_count<>4 then raise exception 'STIMULUS_CONTROL_MISMATCH'; end if;
  select count(distinct value->>'source_product_id') into same_count
    from jsonb_array_elements(s.candidate_snapshots);
  if same_count<>3 then raise exception 'STIMULUS_DUPLICATE_PRODUCT'; end if;
  if not exists(select 1 from jsonb_array_elements(s.candidate_snapshots) candidate
      where candidate->>'source_product_id'=s.final_product_id) then raise exception 'STIMULUS_FINAL_OUTSIDE_CANDIDATES'; end if;
  for item in select value from jsonb_array_elements(s.candidate_snapshots) loop
    select * into source_product from public.study_products
      where source_product_id=item->>'source_product_id' and reviewed
        and profile_codes @> array[t.profile_code] and price_krw<=50000;
    if source_product.source_product_id is null
      or item->>'name_ko' is distinct from source_product.name_ko
      or item->>'name_original' is distinct from source_product.name_original
      or item->>'description_original' is distinct from source_product.description_original
      or (item->>'price_krw')::integer is distinct from source_product.price_krw
      or item->>'image_url' is distinct from source_product.image_url
      then raise exception 'STIMULUS_PRODUCT_MISMATCH'; end if;
  end loop;
  update public.study_trials set stimulus_id=s.id,candidate_snapshots=s.candidate_snapshots,revision=revision+1
    where id=t.id;
  for item in select value from jsonb_array_elements(s.transcript) loop
    insert into public.study_messages(trial_id,phase,speaker,origin,kind,content,payload)
    values(t.id,coalesce(item->>'phase','candidates'),
      case when item->>'speaker'='giver' then 'scripted_giver' else 'agent' end,
      'scripted',coalesce(item->>'kind','text'),coalesce(item->>'content',''),
      coalesce(item->'payload','{}'::jsonb)||jsonb_build_object('stimulus_id',s.id,'stimulus_version',s.stimulus_version,'offset_ms',coalesce((item->>'offset_ms')::integer,0)));
  end loop;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,actor,origin,event_type,payload)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,t.phase,'system','system',
    'approved_stimulus_attached',jsonb_build_object('stimulus_id',s.id,'stimulus_version',s.stimulus_version));
  return jsonb_build_object('attached',true);
end; $$;

revoke all on function public.study_enroll(text,uuid,text) from public,anon,authenticated;
revoke all on function public.study_begin_new_person(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.study_assign_participant_number() from public,anon,authenticated;
revoke all on function public.study_activate(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.study_ping(uuid,text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.study_mark_candidates_visible(uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_advance(uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_finish_survey(uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_skip_timed_out(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_store_proposal(uuid,uuid,uuid,text,text,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.study_claim_agent(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.study_release_agent(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_confirm_candidate(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.study_store_batch(uuid,uuid,uuid,text[],jsonb,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.study_finalize(uuid,uuid,text,text,text,uuid,text,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.study_attach_stimulus(uuid,uuid) from public,anon,authenticated;
grant execute on function public.study_enroll(text,uuid,text) to service_role;
grant execute on function public.study_begin_new_person(uuid,text,uuid,text) to service_role;
grant execute on function public.study_activate(uuid,uuid,text,uuid) to service_role;
grant execute on function public.study_ping(uuid,text,bigint,boolean) to service_role;
grant execute on function public.study_mark_candidates_visible(uuid,uuid) to service_role;
grant execute on function public.study_advance(uuid,uuid) to service_role;
grant execute on function public.study_finish_survey(uuid,uuid) to service_role;
grant execute on function public.study_skip_timed_out(uuid,uuid,uuid) to service_role;
grant execute on function public.study_store_proposal(uuid,uuid,uuid,text,text,text,text,text,integer,text) to service_role;
grant execute on function public.study_claim_agent(uuid,uuid,text,uuid) to service_role;
grant execute on function public.study_release_agent(uuid,uuid,uuid) to service_role;
grant execute on function public.study_confirm_candidate(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.study_store_batch(uuid,uuid,uuid,text[],jsonb,text,text,text,integer,jsonb) to service_role;
grant execute on function public.study_finalize(uuid,uuid,text,text,text,uuid,text,text,integer,text,text) to service_role;
grant execute on function public.study_attach_stimulus(uuid,uuid) to service_role;
commit;
notify pgrst, 'reload schema';
