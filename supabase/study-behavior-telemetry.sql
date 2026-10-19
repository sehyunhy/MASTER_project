-- Apply once to the existing study 7.1 database. Preserves every existing row.
-- Install this before deploying the matching application code.
begin;

alter table public.study_events
  add column if not exists event_schema_version smallint not null default 1,
  add column if not exists visit_id uuid,
  add column if not exists tab_id text,
  add column if not exists client_sequence bigint,
  add column if not exists client_elapsed_ms bigint,
  add column if not exists phase_at_capture text,
  add column if not exists ui_surface text,
  add column if not exists operation_id uuid;
create index if not exists study_events_visit_sequence
  on public.study_events(trial_id,visit_id,client_sequence)
  where visit_id is not null;
create index if not exists study_events_type_time
  on public.study_events(event_type,server_at);

alter table public.study_trials
  add column if not exists draft_selected_product_id text,
  add column if not exists draft_reason text,
  add column if not exists draft_updated_at timestamptz,
  add column if not exists draft_client_sequence bigint not null default 0;

create table if not exists public.study_survey_responses (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.study_people(id) on delete cascade,
  participant_number text not null,
  role text not null check(role in ('giver','recipient')),
  trial_id uuid references public.study_trials(id) on delete cascade,
  form_section text not null check(form_section in ('baseline','pretrial','posttrial','final','crossrole')),
  form_version text not null,
  answers jsonb not null check(jsonb_typeof(answers)='object'),
  paper_form_id text,
  entered_by text not null,
  entered_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revision_history jsonb not null default '[]'::jsonb check(jsonb_typeof(revision_history)='array'),
  check(form_section<>'posttrial' or trial_id is not null)
);
alter table public.study_survey_responses
  add column if not exists revision_history jsonb not null default '[]'::jsonb;
create unique index if not exists study_survey_responses_once
  on public.study_survey_responses(person_id,role,form_section,
    coalesce(trial_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists study_survey_responses_participant
  on public.study_survey_responses(participant_number,role,form_section);
alter table public.study_survey_responses enable row level security;

create or replace function public.study_validate_survey_response()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.study_people%rowtype; t public.study_trials%rowtype;
begin
  select * into p from public.study_people where id=new.person_id;
  if p.id is null then raise exception 'SURVEY_PERSON_MISSING'; end if;
  new.participant_number:=case when new.role='giver' then p.giver_number else p.recipient_number end;
  if new.trial_id is not null then
    select * into t from public.study_trials where id=new.trial_id;
    if t.id is null or t.person_id<>new.person_id or t.role<>new.role then
      raise exception 'SURVEY_TRIAL_MISMATCH'; end if;
  end if;
  if tg_op='UPDATE' then
    new.revision_history:=coalesce(old.revision_history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'answers',old.answers,'form_version',old.form_version,'paper_form_id',old.paper_form_id,
      'entered_by',old.entered_by,'replaced_at',clock_timestamp()));
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end; $$;
drop trigger if exists study_validate_survey_response on public.study_survey_responses;
create trigger study_validate_survey_response before insert or update on public.study_survey_responses
  for each row execute function public.study_validate_survey_response();

alter table public.study_events drop constraint if exists study_events_actor_check;
alter table public.study_events add constraint study_events_actor_check
  check(actor in ('participant','agent','scripted_giver','system','researcher'));
alter table public.study_events drop constraint if exists study_events_origin_check;
alter table public.study_events add constraint study_events_origin_check
  check(origin in ('participant','agent','scripted','system','researcher'));

create or replace function public.study_audit_survey_entry()
returns trigger language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; old_hash text;
begin
  if tg_op='UPDATE' then old_hash:=encode(digest(old.answers::text,'sha256'),'hex'); end if;
  if new.trial_id is not null then
    select * into t from public.study_trials where id=new.trial_id;
  end if;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,
    actor,origin,event_type,payload)
  values(new.person_id,new.trial_id,new.role,t.condition,t.order_position,
    case when new.trial_id is null then null else t.phase end,
    'researcher','researcher',
    case when tg_op='INSERT' then 'paper_survey_entered' else 'paper_survey_corrected' end,
    jsonb_build_object('survey_id',new.id,'form_section',new.form_section,
      'form_version',new.form_version,'paper_form_id',new.paper_form_id,
      'entered_by',new.entered_by,'answer_keys',
        (select jsonb_agg(answer_key.key order by answer_key.key)
          from jsonb_object_keys(new.answers) as answer_key(key)),
      'old_answers_sha256',old_hash,
      'new_answers_sha256',encode(digest(new.answers::text,'sha256'),'hex')));
  return new;
end; $$;
drop trigger if exists study_audit_survey_entry on public.study_survey_responses;
create trigger study_audit_survey_entry after insert or update on public.study_survey_responses
  for each row execute function public.study_audit_survey_entry();

create or replace function public.study_save_decision_draft(
  p_trial_id uuid,p_person_id uuid,p_product_id text,p_reason text,
  p_client_sequence bigint,p_event_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp();
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'giver' or t.phase<>'decision' or t.decision_actor<>'human'
    or t.final_product_id is not null then raise exception 'DRAFT_NOT_ALLOWED'; end if;
  if p_client_sequence is null or p_client_sequence<0 or p_event_key is null
    or length(coalesce(p_reason,''))>1500 then raise exception 'DRAFT_INVALID'; end if;
  if p_product_id is not null and not exists(
    select 1 from jsonb_array_elements(t.candidate_snapshots) item
      where item->>'source_product_id'=p_product_id)
    then raise exception 'PRODUCT_OUTSIDE_CANDIDATES'; end if;
  if p_client_sequence<=t.draft_client_sequence then
    return jsonb_build_object('saved',true,'stale',true,'sequence',t.draft_client_sequence);
  end if;
  update public.study_trials set draft_selected_product_id=p_product_id,
    draft_reason=p_reason,draft_client_sequence=p_client_sequence,
    draft_updated_at=now_at,updated_at=now_at where id=t.id;
  insert into public.study_events(person_id,trial_id,role,condition,order_position,phase,
    actor,origin,event_type,payload,idempotency_key)
  values(t.person_id,t.id,t.role,t.condition,t.order_position,'decision',
    'participant','participant','decision_draft_saved',
    jsonb_build_object('source_product_id',p_product_id,'reason_length',length(coalesce(p_reason,'')),
      'client_sequence',p_client_sequence,'phase_effective_ms',t.phase_effective_ms),p_event_key)
  on conflict do nothing;
  return jsonb_build_object('saved',true,'sequence',p_client_sequence);
end; $$;
revoke all on function public.study_save_decision_draft(uuid,uuid,text,text,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.study_save_decision_draft(uuid,uuid,text,text,bigint,uuid)
  to service_role;
revoke all on function public.study_validate_survey_response() from public,anon,authenticated;
revoke all on function public.study_audit_survey_entry() from public,anon,authenticated;

commit;
notify pgrst, 'reload schema';
