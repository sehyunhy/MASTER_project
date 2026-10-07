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
