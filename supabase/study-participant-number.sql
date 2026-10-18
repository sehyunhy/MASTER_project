-- Run once in Supabase SQL Editor on an EXISTING six-table study database.
-- Keeps existing rows. Run study-reset-test-rows.sql separately if all pilot
-- rows should be erased. The application must be deployed with this SQL.
begin;

alter table public.study_people add column if not exists participant_number text;
alter table public.study_trials add column if not exists participant_number text;
alter table public.study_messages add column if not exists participant_number text;
alter table public.study_events add column if not exists participant_number text;

-- Old records did not have a researcher-entered code. Label them as legacy;
-- do not pretend that these codes were entered by the participant.
update public.study_people set participant_number='L'||lpad(enrollment_number::text,6,'0')
  where participant_number is null;
update public.study_trials t set participant_number=p.participant_number
  from public.study_people p where t.person_id=p.id and t.participant_number is distinct from p.participant_number;
update public.study_messages m set participant_number=t.participant_number
  from public.study_trials t where m.trial_id=t.id and m.participant_number is distinct from t.participant_number;
update public.study_events e set participant_number=p.participant_number
  from public.study_people p where e.person_id=p.id and e.participant_number is distinct from p.participant_number;

create unique index if not exists study_people_participant_number_key on public.study_people(participant_number);
create index if not exists study_trials_participant_number on public.study_trials(participant_number,role,order_position);
create index if not exists study_messages_participant_number on public.study_messages(participant_number,id);
create index if not exists study_events_participant_number on public.study_events(participant_number,server_at,id);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.study_people'::regclass
    and conname='study_people_participant_number_format') then
    alter table public.study_people add constraint study_people_participant_number_format
      check(participant_number ~ '^[A-Z0-9-]{1,12}$');
  end if;
end $$;
alter table public.study_people alter column participant_number set not null;
alter table public.study_trials alter column participant_number set not null;
alter table public.study_messages alter column participant_number set not null;
alter table public.study_events alter column participant_number set not null;

create or replace function public.study_assign_participant_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='study_trials' then
    new.participant_number := (select participant_number from public.study_people where id=new.person_id);
  elsif tg_table_name='study_messages' then
    new.participant_number := (select participant_number from public.study_trials where id=new.trial_id);
  elsif tg_table_name='study_events' then
    new.participant_number := (select participant_number from public.study_people where id=new.person_id);
  end if;
  if new.participant_number is null then raise exception 'PARTICIPANT_NUMBER_MISSING'; end if;
  return new;
end; $$;
drop trigger if exists study_trials_participant_number on public.study_trials;
create trigger study_trials_participant_number before insert or update on public.study_trials
  for each row execute function public.study_assign_participant_number();
drop trigger if exists study_messages_participant_number on public.study_messages;
create trigger study_messages_participant_number before insert or update on public.study_messages
  for each row execute function public.study_assign_participant_number();
drop trigger if exists study_events_participant_number on public.study_events;
create trigger study_events_participant_number before insert or update on public.study_events
  for each row execute function public.study_assign_participant_number();

create or replace function public.study_enroll(p_role text,p_browser_key uuid,p_participant_number text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.study_people%rowtype; block_index bigint; within_block integer; sequence_index integer;
  sequence_value text[]; role_name text; item text; pos integer;
begin
  p_participant_number:=upper(trim(p_participant_number));
  if p_role not in ('giver','recipient') or p_browser_key is null
    or p_participant_number is null or p_participant_number !~ '^[A-Z0-9-]{1,12}$'
    then raise exception 'INVALID_ENROLLMENT'; end if;
  perform pg_advisory_xact_lock(hashtext('study-enrollment'));
  select * into p from public.study_people where browser_key=p_browser_key;
  if found then
    if p.participant_number<>p_participant_number then raise exception 'PARTICIPANT_NUMBER_MISMATCH'; end if;
    return jsonb_build_object('person_id',p.id,'participant_number',p.participant_number,
      'enrollment_number',p.enrollment_number,'active_role',p.active_role);
  end if;
  if exists(select 1 from public.study_people where participant_number=p_participant_number)
    then raise exception 'PARTICIPANT_NUMBER_TAKEN'; end if;
  insert into public.study_people(participant_number,browser_key,first_role,active_role,role_order,
    condition_order,order_index,enrollment_block,profile_code)
  values(p_participant_number,p_browser_key,p_role,p_role,array[p_role,case when p_role='giver' then 'recipient' else 'giver' end],
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
      insert into public.study_trials(person_id,role,order_position,condition,candidate_builder,decision_actor,profile_code)
      values(p.id,role_name,pos,item,
        case when item in ('A','C') then 'human' else 'agent' end,
        case when item in ('A','B') then 'human' else 'agent' end,p.profile_code);
    end loop;
  end loop;
  insert into public.study_events(person_id,role,actor,origin,event_type,payload)
  values(p.id,p_role,'system','system','enrolled',jsonb_build_object('block',p.enrollment_block,'order',p.condition_order));
  return jsonb_build_object('person_id',p.id,'participant_number',p.participant_number,
    'enrollment_number',p.enrollment_number,'active_role',p.active_role);
end; $$;

create or replace function public.study_begin_new_person(p_previous_id uuid,p_role text,p_browser_key uuid,p_participant_number text)
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

-- Remove old RPC signatures so enrollment cannot bypass the entered number.
drop function if exists public.study_begin_new_person(uuid,text,uuid);
drop function if exists public.study_enroll(text,uuid);
revoke all on function public.study_assign_participant_number() from public,anon,authenticated;
revoke all on function public.study_enroll(text,uuid,text) from public,anon,authenticated;
revoke all on function public.study_begin_new_person(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.study_enroll(text,uuid,text) to service_role;
grant execute on function public.study_begin_new_person(uuid,text,uuid,text) to service_role;
commit;
notify pgrst, 'reload schema';
