-- Apply in Supabase SQL Editor after 0005. Existing accumulated exposure is preserved.
-- Changes only the policy threshold; it does not rewrite actual elapsed times.

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


revoke all on function public.phase_content_ready(uuid,text,text) from public, anon, authenticated;
revoke all on function public.phase_heartbeat(uuid,text,text,bigint,boolean) from public, anon, authenticated;
revoke all on function public.advance_trial_phase(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.phase_content_ready(uuid,text,text) to service_role;
grant execute on function public.phase_heartbeat(uuid,text,text,bigint,boolean) to service_role;
grant execute on function public.advance_trial_phase(uuid,text,text,text) to service_role;
