-- Researcher action: fill all four strings with approved wording before running
-- this file in the Supabase SQL Editor. Empty strings abort without writing.
-- No schema change is required; experiment_configs already exists.
do $$
declare
  high_relationship_type text := '';
  high_situation text := '';
  low_relationship_type text := '';
  low_situation text := '';
begin
  if trim(high_relationship_type) = '' or trim(high_situation) = ''
    or trim(low_relationship_type) = '' or trim(low_situation) = '' then
    raise exception 'Enter the researcher-approved relationship type and situation for both intimacy conditions.';
  end if;

  insert into public.experiment_configs (key, value, version)
  values (
    'relationship_context_v1',
    jsonb_build_object(
      'high', jsonb_build_object('relationship_type', high_relationship_type, 'situation', high_situation),
      'low', jsonb_build_object('relationship_type', low_relationship_type, 'situation', low_situation)
    ),
    '4.0.0'
  )
  on conflict (key) do update
    set value = excluded.value, version = excluded.version, updated_at = now();
end $$;
