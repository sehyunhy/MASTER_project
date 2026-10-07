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
