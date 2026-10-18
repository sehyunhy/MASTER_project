-- Gift-choice experiment v6.0.0. Run once in Supabase SQL Editor after reviewing
-- the project and product catalog. Additive only: prior rows remain unchanged.
begin;

alter table public.participants alter column intimacy_condition drop not null;
alter table public.participants add column if not exists v6_roster boolean not null default false;
alter table public.trials add column if not exists candidate_mode text;
alter table public.trials add column if not exists condition_position smallint;
alter table public.trials add column if not exists completion_outcome text;
alter table public.trials add column if not exists final_decision_source text;
alter table public.trials add column if not exists agent_reason_text text;
alter table public.final_selections add column if not exists is_simulated boolean not null default false;
alter table public.final_selections add column if not exists participant_reason_text text;
alter table public.final_selections add column if not exists reason_created_at timestamptz;
alter table public.final_selections add column if not exists reason_confirmed_at timestamptz;
alter table public.trials alter column experiment_version set default '6.0.0';

insert into public.experiment_sequences(id,sequence_name,position_1,position_2,position_3,position_4,version) values
 ('V6S1','V6S1','C1','C2','C4','C3','williams-v6'),
 ('V6S2','V6S2','C2','C3','C1','C4','williams-v6'),
 ('V6S3','V6S3','C3','C4','C2','C1','williams-v6'),
 ('V6S4','V6S4','C4','C1','C3','C2','williams-v6')
on conflict(id) do update set sequence_name=excluded.sequence_name,position_1=excluded.position_1,
  position_2=excluded.position_2,position_3=excluded.position_3,position_4=excluded.position_4,version=excluded.version;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='trials_candidate_mode_v6_check' and conrelid='public.trials'::regclass) then
    alter table public.trials add constraint trials_candidate_mode_v6_check
      check(candidate_mode is null or candidate_mode in ('human_sequential','agent_batch'));
  end if;
  if not exists(select 1 from pg_constraint where conname='trials_completion_outcome_v6_check' and conrelid='public.trials'::regclass) then
    alter table public.trials add constraint trials_completion_outcome_v6_check
      check(completion_outcome is null or completion_outcome in ('complete','timeout','incomplete'));
  end if;
end $$;

create table if not exists public.research_subjects (
  id uuid primary key default gen_random_uuid(),
  study_code text not null unique,
  role_order text[] not null check(role_order in (array['giver','recipient']::text[],array['recipient','giver']::text[])),
  sequence_id text not null references public.experiment_sequences(id),
  profile_rotation_offset smallint not null check(profile_rotation_offset between 0 and 3),
  experiment_version text not null default '6.0.0',
  status text not null default 'assigned' check(status in ('assigned','active','completed','withdrawn')),
  current_role_index smallint not null default 0 check(current_role_index between 0 and 2),
  enrollment_block smallint not null check(enrollment_block between 1 and 6),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.research_subjects add column if not exists enrollment_block smallint not null default 1;
alter table public.research_subjects drop constraint if exists research_subjects_study_code_check;
alter table public.research_subjects add constraint research_subjects_study_code_check check(study_code ~ '^(S|N)[0-9]{3}$');
alter table public.research_subjects enable row level security;

create table if not exists public.role_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.research_subjects(id) on delete restrict,
  role text not null check(role in ('giver','recipient')),
  role_order_index smallint not null check(role_order_index in (1,2)),
  participant_id uuid not null unique references public.participants(id) on delete restrict,
  profile_rotation_offset smallint not null default 0 check(profile_rotation_offset between 0 and 3),
  status text not null default 'assigned' check(status in ('assigned','active','completed','withdrawn')),
  next_trial_number smallint not null default 1 check(next_trial_number between 1 and 5),
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(subject_id,role), unique(subject_id,role_order_index)
);
alter table public.role_sessions enable row level security;
create index if not exists role_sessions_subject_order on public.role_sessions(subject_id,role_order_index);

create table if not exists public.v6_phase_records (
  id uuid primary key default gen_random_uuid(), trial_id uuid not null references public.trials(id) on delete cascade,
  phase text not null check(phase in ('candidates','decision')),
  phase_status text not null default 'active' check(phase_status in ('active','completed','timeout')),
  started_at timestamptz not null default now(), ended_at timestamptz,
  end_reason text check(end_reason is null or end_reason in ('participant_advanced','timeout')),
  effective_exposure_ms integer not null default 0 check(effective_exposure_ms between 0 and 180000),
  last_heartbeat_at timestamptz, last_sequence bigint not null default -1,
  active_tab_id text, lease_until timestamptz, paused_at timestamptz,
  updated_at timestamptz not null default now(), unique(trial_id,phase)
);
alter table public.v6_phase_records enable row level security;
create index if not exists v6_phase_trial on public.v6_phase_records(trial_id,phase);

create table if not exists public.v6_candidate_requests (
  id uuid primary key default gen_random_uuid(), trial_id uuid not null references public.trials(id) on delete cascade,
  participant_id uuid not null references public.participants(id), slot_number smallint not null check(slot_number between 1 and 3),
  request_revision smallint not null check(request_revision>0), request_text text not null,
  idempotency_key uuid not null, actor_type text not null default 'participant' check(actor_type='participant'),
  status text not null check(status in ('processing','proposed','confirmed','replaced','failed')),
  product_catalog_id uuid references public.product_catalog(id), source_product_id text, product_snapshot jsonb,
  response_text text, claude_model text, claude_response_id text, claude_latency_ms integer,
  prompt_version text, proposed_at timestamptz, confirmed_at timestamptz, error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(trial_id,idempotency_key), unique(trial_id,slot_number,request_revision)
);
alter table public.v6_candidate_requests enable row level security;
create index if not exists v6_candidate_requests_trial_slot on public.v6_candidate_requests(trial_id,slot_number,request_revision);

-- Recipient-role records are researcher-authored scenario stimuli, not paired
-- giver behavior. One reviewed set is stored for each profile × condition.
create table if not exists public.v6_stimuli (
  id uuid primary key default gen_random_uuid(), scenario_id text not null, condition_id text not null check(condition_id in ('C1','C2','C3','C4')),
  profile_id text not null references public.recipient_profiles(id), profile_version text not null, version integer not null default 1,
  source_kind text not null default 'scripted' check(source_kind='scripted'), transcript jsonb not null,
  candidate_snapshots jsonb not null check(jsonb_typeof(candidate_snapshots)='array' and jsonb_array_length(candidate_snapshots)=3),
  final_source_product_id text not null, candidate_order text[] not null check(cardinality(candidate_order)=3),
  review_status text not null default 'draft' check(review_status in ('draft','approved','retired')),
  reviewed_by text, frozen_at timestamptz, content_hash text, created_at timestamptz not null default now(),
  unique(scenario_id,condition_id,profile_version), check((review_status='approved')=(frozen_at is not null))
);
alter table public.v6_stimuli enable row level security;
create index if not exists v6_stimuli_lookup on public.v6_stimuli(scenario_id,condition_id,review_status);

create table if not exists public.v6_transition_attempts (
  id bigint generated always as identity primary key, role_session_id uuid not null references public.role_sessions(id) on delete cascade,
  trial_number smallint not null check(trial_number between 1 and 4), success boolean not null,
  idempotency_key text not null, server_timestamp timestamptz not null default now(), unique(role_session_id,idempotency_key)
);
alter table public.v6_transition_attempts enable row level security;
create table if not exists public.v6_transition_code_slots (
  trial_number smallint primary key check(trial_number between 1 and 4), code_sha256 text not null check(code_sha256 ~ '^[0-9a-f]{64}$'),
  version text not null default 'transition-codes-v6'
);
alter table public.v6_transition_code_slots enable row level security;
insert into public.v6_transition_code_slots(trial_number,code_sha256) values
 (1,'26d228663f13a88592a12d16cf9587caab0388b262d6d9f126ed62f9333aca94'),
 (2,'e6fcc0253ed7a328a10eb6e2e1ad6abcad60c374c64dbac4b76da610085b43d8'),
 (3,'03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'),
 (4,'7e9d8f999b81df9edb764eaa5473f5e7d39c45ad9c8948eee0c210bd9c1c5')
on conflict(trial_number) do update set code_sha256=excluded.code_sha256,version=excluded.version;

create or replace function public.v6_verify_transition_code(p_participant_id uuid,p_code_sha256 text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.role_sessions%rowtype; sub public.research_subjects%rowtype; t public.trials%rowtype; prev public.trials%rowtype;
  slot public.v6_transition_code_slots%rowtype; old public.v6_transition_attempts%rowtype; ok boolean; n smallint; now_at timestamptz:=clock_timestamp();
begin
  if p_idempotency_key is null or length(p_idempotency_key)>100 then raise exception 'V6_INVALID_REQUEST_KEY'; end if;
  select * into s from public.role_sessions where participant_id=p_participant_id for update;
  if not found then raise exception 'V6_ROLE_SESSION_NOT_FOUND'; end if;
  select * into old from public.v6_transition_attempts where role_session_id=s.id and idempotency_key=p_idempotency_key;
  if found then
    if old.success then select * into t from public.trials where participant_id=p_participant_id and trial_number=old.trial_number;
      return jsonb_build_object('accepted',true,'idempotent',true,'trial_id',t.id,'trial_number',old.trial_number,'next_trial_number',s.next_trial_number); end if;
    return jsonb_build_object('accepted',false,'idempotent',true,'trial_number',old.trial_number,'next_trial_number',s.next_trial_number);
  end if;
  select * into sub from public.research_subjects where id=s.subject_id for update;
  if sub.experiment_version<>'6.0.0' or s.status in ('completed','withdrawn') or sub.status='withdrawn' then raise exception 'V6_ROLE_SESSION_CLOSED'; end if;
  if sub.role_order[sub.current_role_index+1] is distinct from s.role then raise exception 'V6_ROLE_ORDER_LOCKED'; end if;
  n:=s.next_trial_number; if n>4 then return jsonb_build_object('accepted',false,'role_complete',true); end if;
  if n>1 then
    select * into prev from public.trials where participant_id=p_participant_id and trial_number=n-1;
    if not found or prev.status<>'completed' then raise exception 'V6_PREVIOUS_CONDITION_INCOMPLETE'; end if;
    if not exists(select 1 from public.v5_surveys where trial_id=prev.id and status in ('submitted','paper_completed')) then raise exception 'V6_PREVIOUS_SURVEY_INCOMPLETE'; end if;
  end if;
  select * into slot from public.v6_transition_code_slots where trial_number=n;
  ok:=p_code_sha256=slot.code_sha256;
  insert into public.v6_transition_attempts(role_session_id,trial_number,success,idempotency_key) values(s.id,n,ok,p_idempotency_key);
  if not ok then return jsonb_build_object('accepted',false,'next_trial_number',n); end if;
  select * into t from public.trials where participant_id=p_participant_id and trial_number=n for update;
  if not found then raise exception 'V6_TRIAL_NOT_PROVISIONED'; end if;
  update public.trials set status='active',current_phase='candidates',started_at=coalesce(started_at,now_at) where id=t.id and status='pending';
  update public.role_sessions set status='active',started_at=coalesce(started_at,now_at),next_trial_number=n+1,updated_at=now_at where id=s.id;
  return jsonb_build_object('accepted',true,'trial_id',t.id,'trial_number',n,'next_trial_number',n+1);
end; $$;
revoke all on function public.v6_verify_transition_code(uuid,text,text) from public,anon,authenticated;
grant execute on function public.v6_verify_transition_code(uuid,text,text) to service_role;

create or replace function public.v6_confirm_trial_intro(p_trial_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.trials%rowtype; n timestamptz:=clock_timestamp();
begin
  select * into t from public.trials where id=p_trial_id and participant_id=p_participant_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.status<>'active' or t.current_phase<>'candidates' then raise exception 'V6_INTRO_NOT_ACTIVE'; end if;
  update public.trials set trial_intro_confirmed_at=coalesce(trial_intro_confirmed_at,n),started_at=coalesce(started_at,n) where id=p_trial_id;
  return jsonb_build_object('ok',true,'confirmed_at',n);
end; $$;

create or replace function public.v6_complete_role_session(p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.role_sessions%rowtype; sub public.research_subjects%rowtype; now_at timestamptz:=clock_timestamp();
begin
  select * into s from public.role_sessions where participant_id=p_participant_id for update;
  if not found then raise exception 'V6_ROLE_SESSION_NOT_FOUND'; end if;
  if s.status='completed' then
    select * into sub from public.research_subjects where id=s.subject_id;
    return jsonb_build_object('ok',true,'idempotent',true,'subject_complete',sub.status='completed');
  end if;
  if exists(select 1 from public.trials where participant_id=p_participant_id and status<>'completed') then raise exception 'V6_ROLE_TRIALS_INCOMPLETE'; end if;
  update public.role_sessions set status='completed',completed_at=coalesce(completed_at,now_at),next_trial_number=5,updated_at=now_at where id=s.id;
  select * into sub from public.research_subjects where id=s.subject_id for update;
  if sub.role_order[sub.current_role_index+1] is distinct from s.role then raise exception 'V6_ROLE_ORDER_LOCKED'; end if;
  update public.research_subjects set current_role_index=current_role_index+1,status=case when current_role_index=1 then 'completed' else 'active' end,updated_at=now_at where id=sub.id;
  return jsonb_build_object('ok',true,'subject_complete',sub.current_role_index=1);
end; $$;

create or replace function public.v6_phase_ready(p_trial_id uuid,p_phase text,p_tab_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n timestamptz:=clock_timestamp(); t public.trials%rowtype; r public.v6_phase_records%rowtype;
begin
  select * into t from public.trials where id=p_trial_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.status<>'active' or t.current_phase<>p_phase or p_phase not in ('candidates','decision') then raise exception 'V6_PHASE_MISMATCH'; end if;
  if t.trial_intro_confirmed_at is null then raise exception 'V6_INTRO_NOT_CONFIRMED'; end if;
  if p_tab_id is null or length(p_tab_id)>100 then raise exception 'V6_TAB_REQUIRED'; end if;
  insert into public.v6_phase_records(trial_id,phase,started_at,last_heartbeat_at,active_tab_id,lease_until)
  values(p_trial_id,p_phase,n,n,p_tab_id,n+interval '12 seconds') on conflict(trial_id,phase) do nothing;
  select * into r from public.v6_phase_records where trial_id=p_trial_id and phase=p_phase for update;
  if r.phase_status<>'active' then raise exception 'V6_PHASE_ENDED'; end if;
  if r.lease_until>n and r.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  update public.v6_phase_records set last_heartbeat_at=n,active_tab_id=p_tab_id,lease_until=n+interval '12 seconds',paused_at=null,updated_at=n where id=r.id;
  return jsonb_build_object('ready',true,'effective_exposure_ms',r.effective_exposure_ms,'server_now',n);
end; $$;

create or replace function public.v6_phase_heartbeat(p_trial_id uuid,p_phase text,p_tab_id text,p_sequence bigint,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n timestamptz:=clock_timestamp(); t public.trials%rowtype; r public.v6_phase_records%rowtype; d integer:=0; st text; nxt text;
begin
  select * into t from public.trials where id=p_trial_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.current_phase<>p_phase then raise exception 'V6_PHASE_MISMATCH'; end if;
  select * into r from public.v6_phase_records where trial_id=p_trial_id and phase=p_phase for update;
  if not found or r.phase_status<>'active' then raise exception 'V6_PHASE_NOT_ACTIVE'; end if;
  if p_sequence<=r.last_sequence then return jsonb_build_object('accepted',false,'reason','stale_sequence','effective_exposure_ms',r.effective_exposure_ms,'phase_status',r.phase_status); end if;
  if r.lease_until>n and r.active_tab_id is distinct from p_tab_id then raise exception 'ANOTHER_TAB_ACTIVE'; end if;
  if p_active and r.last_heartbeat_at is not null and r.paused_at is null then d:=greatest(0,floor(extract(epoch from(n-r.last_heartbeat_at))*1000)::integer); if d>5000 then d:=0; end if; end if;
  d:=least(d,greatest(0,180000-r.effective_exposure_ms)); st:=case when r.effective_exposure_ms+d>=180000 then 'timeout' else 'active' end;
  update public.v6_phase_records set effective_exposure_ms=effective_exposure_ms+d,last_heartbeat_at=case when p_active and st='active' then n else null end,
    last_sequence=p_sequence,active_tab_id=p_tab_id,lease_until=n+interval '12 seconds',paused_at=case when p_active and st='active' then null else coalesce(paused_at,n) end,
    phase_status=st,ended_at=case when st='timeout' then n else ended_at end,end_reason=case when st='timeout' then 'timeout' else end_reason end,updated_at=n where id=r.id returning * into r;
  if st='timeout' then
    nxt:=case when p_phase='candidates' and (select count(*) from public.trial_candidates where trial_id=p_trial_id)=3 then 'decision' else 'awaiting_survey' end;
    update public.trials set completion_outcome='timeout',current_phase=nxt,status=case when nxt='awaiting_survey' then 'awaiting_survey' else 'active' end,active_tab_id=null,active_tab_lease_until=null where id=p_trial_id;
    if nxt='awaiting_survey' then insert into public.v5_surveys(trial_id,status) values(p_trial_id,'pending') on conflict(trial_id) do nothing; end if;
  end if;
  return jsonb_build_object('accepted',true,'delta_ms',d,'effective_exposure_ms',r.effective_exposure_ms,'phase_status',r.phase_status,'timed_out',st='timeout','server_now',n);
end; $$;

create or replace function public.v6_advance_phase(p_trial_id uuid,p_phase text,p_tab_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n timestamptz:=clock_timestamp(); t public.trials%rowtype; r public.v6_phase_records%rowtype; nxt text; elapsed integer;
begin
  select * into t from public.trials where id=p_trial_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.status<>'active' or t.current_phase<>p_phase then raise exception 'V6_PHASE_MISMATCH'; end if;
  select * into r from public.v6_phase_records where trial_id=p_trial_id and phase=p_phase for update;
  if not found or r.phase_status<>'active' or r.active_tab_id is distinct from p_tab_id or r.lease_until<n or r.last_heartbeat_at is null or r.last_heartbeat_at<n-interval '5 seconds' then raise exception 'V6_CONTENT_NOT_ACTIVE'; end if;
  elapsed:=r.effective_exposure_ms;
  if r.paused_at is null then elapsed:=elapsed+least(5000,greatest(0,floor(extract(epoch from(n-r.last_heartbeat_at))*1000)::integer)); end if;
  elapsed:=least(180000,elapsed);
  if elapsed>=180000 then
    nxt:=case when p_phase='candidates' and (select count(*) from public.trial_candidates where trial_id=p_trial_id)=3 then 'decision' else 'awaiting_survey' end;
    update public.v6_phase_records set effective_exposure_ms=elapsed,phase_status='timeout',ended_at=n,end_reason='timeout',active_tab_id=null,lease_until=null,updated_at=n where id=r.id;
    update public.trials set completion_outcome='timeout',current_phase=nxt,status=case when nxt='awaiting_survey' then 'awaiting_survey' else 'active' end,active_tab_id=null,active_tab_lease_until=null where id=p_trial_id;
    if nxt='awaiting_survey' then insert into public.v5_surveys(trial_id,status) values(p_trial_id,'pending') on conflict(trial_id) do nothing; end if;
    return jsonb_build_object('timed_out',true,'phase',nxt,'effective_exposure_ms',elapsed,'advanced_at',n);
  end if;
  if elapsed<60000 then raise exception 'V6_MIN_EXPOSURE_NOT_MET'; end if;
  if p_phase='candidates' and (select count(*) from public.trial_candidates where trial_id=p_trial_id)<>3 and coalesce(t.completion_outcome,'')<>'timeout' then raise exception 'V6_CANDIDATES_NOT_READY'; end if;
  if p_phase='decision' and not exists(select 1 from public.final_selections where trial_id=p_trial_id) and coalesce(t.completion_outcome,'')<>'timeout' then raise exception 'V6_DECISION_NOT_READY'; end if;
  nxt:=case p_phase when 'candidates' then 'decision' else 'awaiting_survey' end;
  update public.v6_phase_records set effective_exposure_ms=elapsed,phase_status='completed',ended_at=n,end_reason='participant_advanced',active_tab_id=null,lease_until=null,updated_at=n where id=r.id;
  update public.trials set current_phase=nxt,status=case when nxt='awaiting_survey' then 'awaiting_survey' else 'active' end,
    active_tab_id=null,active_tab_lease_until=null,completion_outcome=case when t.completion_outcome='timeout' then 'timeout' else 'complete' end where id=p_trial_id;
  if p_phase='decision' then insert into public.v5_surveys(trial_id,status) values(p_trial_id,'pending') on conflict(trial_id) do nothing; end if;
  return jsonb_build_object('phase',nxt,'advanced_at',n,'effective_exposure_ms',elapsed);
end; $$;

create or replace function public.v6_confirm_candidate(p_trial_id uuid,p_participant_id uuid,p_tab_id text,p_request_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.trials%rowtype; req public.v6_candidate_requests%rowtype; r public.v6_phase_records%rowtype; p public.product_catalog%rowtype; cid uuid; n timestamptz:=clock_timestamp(); num integer;
begin
  select * into t from public.trials where id=p_trial_id and participant_id=p_participant_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.status<>'active' or t.current_phase<>'candidates' or t.candidate_mode<>'human_sequential' or t.candidate_builder<>'human' then raise exception 'V6_CANDIDATE_CONFIRM_NOT_ALLOWED'; end if;
  select * into req from public.v6_candidate_requests where id=p_request_id and trial_id=p_trial_id for update;
  if not found or req.status not in ('proposed','confirmed') then raise exception 'V6_CANDIDATE_PROPOSAL_NOT_READY'; end if;
  if req.status='confirmed' then return jsonb_build_object('ok',true,'idempotent',true,'slot',req.slot_number); end if;
  select * into r from public.v6_phase_records where trial_id=p_trial_id and phase='candidates' for update;
  if not found or r.phase_status<>'active' or r.active_tab_id is distinct from p_tab_id or r.lease_until<n or r.last_heartbeat_at<n-interval '5 seconds' or r.effective_exposure_ms>=180000 then raise exception 'V6_CONTENT_NOT_ACTIVE'; end if;
  select count(*) into num from public.trial_candidates where trial_id=p_trial_id;
  if num+1<>req.slot_number then raise exception 'V6_CANDIDATE_SLOT_ORDER'; end if;
  select * into p from public.product_catalog where id=req.product_catalog_id and source_product_id=req.source_product_id
    and dataset_version=t.dataset_version and source_type='walmart_csv_snapshot' and experiment_eligible and is_active
    and exists(select 1 from public.recipient_profiles rp where rp.id=t.profile_id and product_catalog.price_experiment<=rp.gift_budget and product_catalog.profile_codes @> array[rp.profile_code]);
  if not found then raise exception 'V6_PRODUCT_SCOPE_INVALID'; end if;
  if exists(select 1 from public.trial_candidates where trial_id=p_trial_id and product_snapshot->>'source_product_id'=req.source_product_id) then raise exception 'V6_DUPLICATE_CANDIDATE'; end if;
  insert into public.gift_candidates(profile_id,candidate_set_id,product_catalog_id,product_name,category,price,description,image_url,product_snapshot,version,is_mock)
  values(t.profile_id,'v6-'||p_trial_id::text,p.id,coalesce(p.product_name_ko,p.product_name_original),p.category,p.price_experiment::integer,coalesce(p.description_ko,p.description_original,''),p.image_url,req.product_snapshot,t.candidate_version,false)
  on conflict(profile_id,candidate_set_id,product_name) do update set product_snapshot=excluded.product_snapshot returning id into cid;
  insert into public.trial_candidates(trial_id,gift_candidate_id,display_order,product_snapshot,is_mock,is_simulated)
  values(p_trial_id,cid,req.slot_number,req.product_snapshot,false,false);
  update public.v6_candidate_requests set status='confirmed',confirmed_at=n,updated_at=n where id=req.id;
  update public.trials set candidate_set_id='v6-'||p_trial_id::text where id=p_trial_id;
  return jsonb_build_object('ok',true,'slot',req.slot_number,'candidate_id',cid,'source_product_id',req.source_product_id);
end; $$;

create or replace function public.v6_finalize_selection(p_trial_id uuid,p_participant_id uuid,p_candidate_id uuid,p_actor text,p_reason_text text default null,p_tab_id text default null,p_is_simulated boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.trials%rowtype; r public.v6_phase_records%rowtype; f public.final_selections%rowtype; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.trials where id=p_trial_id and participant_id=p_participant_id for update;
  if not found or t.experiment_version<>'6.0.0' or t.status<>'active' or t.current_phase<>'decision' then raise exception 'V6_SELECTION_PHASE_NOT_ACTIVE'; end if;
  if not exists(select 1 from public.trial_candidates where trial_id=p_trial_id and gift_candidate_id=p_candidate_id) then raise exception 'V6_SELECTION_OUTSIDE_TRIAL'; end if;
  if p_actor='human' then
    if t.decision_authority<>'human' then raise exception 'V6_HUMAN_SELECTION_NOT_ALLOWED'; end if;
    if p_is_simulated then
      if not exists(select 1 from public.participants where id=p_participant_id and role='recipient') then raise exception 'V6_SIMULATED_SELECTION_NOT_ALLOWED'; end if;
    else
      if not exists(select 1 from public.participants where id=p_participant_id and role='giver') then raise exception 'V6_HUMAN_SELECTION_NOT_ALLOWED'; end if;
      if length(trim(coalesce(p_reason_text,'')))<15 or lower(trim(p_reason_text)) in ('그냥','알아서','모르겠음','이유 없음') then raise exception 'V6_SELECTION_REASON_REQUIRED'; end if;
      select * into r from public.v6_phase_records where trial_id=p_trial_id and phase='decision' for update;
      if not found or r.phase_status<>'active' or p_tab_id is null or r.active_tab_id is distinct from p_tab_id or r.lease_until<now_at or r.last_heartbeat_at<now_at-interval '5 seconds' then raise exception 'V6_CONTENT_NOT_ACTIVE'; end if;
    end if;
  elsif p_actor='agent' then
    if t.decision_authority<>'agent' then raise exception 'V6_AGENT_SELECTION_NOT_ALLOWED'; end if;
    if p_is_simulated and not exists(select 1 from public.participants where id=p_participant_id and role='recipient') then raise exception 'V6_SIMULATED_SELECTION_NOT_ALLOWED'; end if;
  else raise exception 'V6_INVALID_ACTOR'; end if;
  select * into f from public.final_selections where trial_id=p_trial_id for update;
  if found then
    if f.selected_candidate_id=p_candidate_id and f.selected_by=p_actor and coalesce(f.participant_reason_text,'')=coalesce(p_reason_text,'') then return jsonb_build_object('ok',true,'idempotent',true,'selection_id',f.id); end if;
    raise exception 'V6_SELECTION_ALREADY_FINAL';
  end if;
  insert into public.final_selections(trial_id,selected_candidate_id,selected_by,selected_at,is_simulated,participant_reason_text,reason_created_at,reason_confirmed_at)
  values(p_trial_id,p_candidate_id,p_actor,now_at,p_is_simulated,case when p_actor='human' and not p_is_simulated then trim(p_reason_text) else null end,case when p_actor='human' and not p_is_simulated then now_at else null end,case when p_actor='human' and not p_is_simulated then now_at else null end)
  returning * into f;
  update public.trials set final_decision_source=p_actor,agent_reason_text=case when p_actor='agent' then trim(p_reason_text) else null end where id=p_trial_id;
  return jsonb_build_object('ok',true,'selection_id',f.id,'selected_candidate_id',f.selected_candidate_id,'selected_by',f.selected_by,'selected_at',f.selected_at);
end; $$;

create table if not exists public.v6_selection_reason_history (
 id bigint generated always as identity primary key, trial_id uuid not null references public.trials(id) on delete cascade,
 participant_id uuid not null references public.participants(id), candidate_id uuid not null references public.gift_candidates(id),
 reason_text text not null, action text not null check(action in ('written','revised','confirmed')),
 server_timestamp timestamptz not null default now(), idempotency_key text not null unique
);
alter table public.v6_selection_reason_history enable row level security;

revoke all on function public.v6_confirm_trial_intro(uuid,uuid) from public,anon,authenticated;
revoke all on function public.v6_complete_role_session(uuid) from public,anon,authenticated;
revoke all on function public.v6_phase_ready(uuid,text,text) from public,anon,authenticated;
revoke all on function public.v6_phase_heartbeat(uuid,text,text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.v6_advance_phase(uuid,text,text) from public,anon,authenticated;
revoke all on function public.v6_confirm_candidate(uuid,uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.v6_finalize_selection(uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.v6_confirm_trial_intro(uuid,uuid) to service_role;
grant execute on function public.v6_complete_role_session(uuid) to service_role;
grant execute on function public.v6_phase_ready(uuid,text,text) to service_role;
grant execute on function public.v6_phase_heartbeat(uuid,text,text,bigint,boolean) to service_role;
grant execute on function public.v6_advance_phase(uuid,text,text) to service_role;
grant execute on function public.v6_confirm_candidate(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.v6_finalize_selection(uuid,uuid,uuid,text,text,text,boolean) to service_role;

commit;
