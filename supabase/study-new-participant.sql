-- Apply in Supabase SQL Editor to an existing study-fresh installation.
-- Keeps all existing participants, trials, products, messages, and events.
-- A researcher can begin a different participant while the browser still has
-- an active participant session. The previous session is marked withdrawn,
-- and its incomplete trials remain available for analysis.
begin;

create or replace function public.study_begin_new_person(p_previous_id uuid,p_role text,p_browser_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.study_people%rowtype; enrolled jsonb; next_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if p_role not in ('giver','recipient') or p_browser_key is null then raise exception 'INVALID_ENROLLMENT'; end if;
  if p_previous_id is not null then
    select * into previous from public.study_people where id=p_previous_id for update;
  end if;
  enrolled:=public.study_enroll(p_role,p_browser_key);
  next_id:=(enrolled->>'person_id')::uuid;
  if previous.id is not null and previous.id<>next_id and previous.status='active' then
    update public.study_people set status='withdrawn',updated_at=now_at where id=previous.id;
    insert into public.study_events(person_id,role,actor,origin,event_type,payload)
    values(previous.id,previous.active_role,'system','system','previous_session_ended_for_new_person',
      jsonb_build_object('new_person_id',next_id,'unfinished_trials_preserved',true));
  end if;
  return enrolled;
end; $$;

revoke all on function public.study_begin_new_person(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.study_begin_new_person(uuid,text,uuid) to service_role;
commit;
