-- DESTRUCTIVE: permanently erases all rows in the six current study tables.
-- Use only for pilot/test data. The six table definitions and RPCs remain.
-- No CASCADE: if another table references these rows, stop and review it.
begin;
truncate table
  public.study_events,
  public.study_messages,
  public.study_trials,
  public.study_people,
  public.study_stimuli,
  public.study_products
restart identity;
commit;
-- After reset, prepare and approve the P02 web stimulus again in /admin.
