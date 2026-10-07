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
    threshold_met_at=case when v_row.accumulated_ms+v_delta>=30000 then coalesce(v_row.threshold_met_at,v_now) else v_row.threshold_met_at end,
    last_heartbeat_at=case when p_active then v_now else null end,
    last_sequence=p_sequence,active_tab_id=p_tab_id,lease_until=v_now+interval '12 seconds',
    paused_at=case when p_active then null else coalesce(paused_at,v_now) end,updated_at=v_now
  where trial_id=p_trial_id and phase=p_phase returning * into v_row;
  return jsonb_build_object('accepted',true,'delta_ms',v_delta,'accumulated_ms',v_row.accumulated_ms,'complete',v_row.accumulated_ms>=30000);
end; $$;
revoke all on function public.phase_heartbeat(uuid,text,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.phase_heartbeat(uuid,text,text,bigint,boolean) to service_role;
