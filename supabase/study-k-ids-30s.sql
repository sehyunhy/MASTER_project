-- Run ONCE on an existing six-table study database after study-participant-number.sql.
-- Existing participants and v1 scripted trials stay unchanged. New IDs are paired:
-- K01 recipient / K02 giver, K03 / K04, and so on.
begin;

alter table public.study_people drop constraint if exists study_people_participant_number_format;
alter table public.study_people add constraint study_people_participant_number_format
  check(participant_number ~ '^[A-Z0-9-]{1,12}$');
alter table public.study_people add column if not exists giver_number text;
alter table public.study_people add column if not exists recipient_number text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.study_people'::regclass
    and conname='study_people_pair_format') then
    alter table public.study_people add constraint study_people_pair_format
      check ((giver_number is null and recipient_number is null)
        or (giver_number is not null and recipient_number is not null
          and giver_number ~ '^K[0-9]{2,8}$' and recipient_number ~ '^K[0-9]{2,8}$'
          and substring(giver_number from 2)::bigint=substring(recipient_number from 2)::bigint+1
          and participant_number in (giver_number,recipient_number)));
  end if;
end $$;
create unique index if not exists study_people_giver_number_key on public.study_people(giver_number);
create unique index if not exists study_people_recipient_number_key on public.study_people(recipient_number);
alter table public.study_events alter column experiment_version set default '7.1.0';
alter table public.study_trials add column if not exists stimulus_version_target text;

create or replace function public.study_assign_participant_number()
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

-- The participant-number triggers already installed by study-participant-number.sql
-- execute this replaced function on every new trial, message and event.

create or replace function public.study_enroll(p_role text,p_browser_key uuid,p_participant_number text)
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


create or replace function public.study_advance(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; now_at timestamptz:=clock_timestamp(); next_phase text;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.phase not in ('candidates','decision') then raise exception 'PHASE_NOT_ACTIVE'; end if;
  if t.phase_effective_ms<10000 then raise exception 'MINIMUM_EXPOSURE_REQUIRED'; end if;
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
  values(t.person_id,t.id,t.role,t.condition,t.order_position,t.phase,'participant','participant','phase_advanced',
    jsonb_build_object('to',next_phase,'effective_ms',t.phase_effective_ms));
  return jsonb_build_object('phase',next_phase);
end; $$;

-- Create new P02 stimuli instead of changing previously observed v1 rows.
insert into public.study_stimuli(profile_code,condition,stimulus_version,origin,
  transcript,candidate_snapshots,final_product_id,approved_at,approved_by)
select s.profile_code,s.condition,'birthday-friend-a-web-v2',s.origin,
  case when s.condition in ('A','C') then
    (select jsonb_agg(
      case (item.value->>'offset_ms')::integer
        when 2000 then jsonb_set(item.value,'{offset_ms}','1000'::jsonb)
        when 10000 then jsonb_set(item.value,'{offset_ms}','4000'::jsonb)
        when 16000 then jsonb_set(item.value,'{offset_ms}','7000'::jsonb)
        when 20000 then jsonb_set(item.value,'{offset_ms}','9000'::jsonb)
        when 28000 then jsonb_set(item.value,'{offset_ms}','12000'::jsonb)
        when 34000 then jsonb_set(item.value,'{offset_ms}','15000'::jsonb)
        when 38000 then jsonb_set(item.value,'{offset_ms}','17000'::jsonb)
        when 46000 then jsonb_set(item.value,'{offset_ms}','20000'::jsonb)
        when 52000 then jsonb_set(item.value,'{offset_ms}','23000'::jsonb)
        else item.value end order by item.ordinality)
      from jsonb_array_elements(s.transcript) with ordinality as item(value,ordinality))
    else s.transcript end,
  s.candidate_snapshots,s.final_product_id,s.approved_at,s.approved_by
from public.study_stimuli s
where s.stimulus_version='birthday-friend-a-web-v1'
on conflict (profile_code,condition,stimulus_version) do nothing;

create or replace function public.study_attach_stimulus(p_trial_id uuid,p_person_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.study_trials%rowtype; s public.study_stimuli%rowtype; item jsonb;
  source_product public.study_products%rowtype;
  approved_count integer; baseline jsonb; same_count integer;
begin
  select * into t from public.study_trials where id=p_trial_id and person_id=p_person_id for update;
  if t.id is null or t.role<>'recipient' or t.phase<>'candidates' then raise exception 'OBSERVATION_NOT_ALLOWED'; end if;
  if t.stimulus_id is not null then return jsonb_build_object('attached',true,'idempotent',true); end if;
  select * into s from public.study_stimuli where profile_code=t.profile_code and condition=t.condition
    and stimulus_version=coalesce(t.stimulus_version_target,'birthday-friend-a-web-v1')
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
grant execute on function public.study_enroll(text,uuid,text) to service_role;
revoke all on function public.study_advance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.study_advance(uuid,uuid) to service_role;
revoke all on function public.study_assign_participant_number() from public,anon,authenticated;
commit;
notify pgrst, 'reload schema';
