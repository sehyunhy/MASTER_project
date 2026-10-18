-- OPTIONAL FINAL APPROVAL. Only run after the researcher has read and edited
-- every draft transcript and verified all four conditions for each profile.
-- This file never runs automatically from the app.
begin;
do $$
declare profile text; total integer; same_products integer; baseline jsonb; baseline_final text;
begin
  foreach profile in array array['R1','R2','R3','R4'] loop
    select count(*),min(candidate_snapshots::text)::jsonb,min(final_product_id)
      into total,baseline,baseline_final
      from public.study_stimuli where profile_code=profile and stimulus_version='study-v7-review-draft';
    select count(*) into same_products from public.study_stimuli
      where profile_code=profile and stimulus_version='study-v7-review-draft'
        and candidate_snapshots=baseline and final_product_id=baseline_final;
    if total<>4 or same_products<>4 then raise exception 'PRODUCT_CONTROL_FAILED: %',profile; end if;
    if (select count(distinct condition) from public.study_stimuli
      where profile_code=profile and stimulus_version='study-v7-review-draft')<>4
      then raise exception 'CONDITION_SET_INCOMPLETE: %',profile; end if;
  end loop;
  update public.study_stimuli set approved_at=clock_timestamp(),approved_by='researcher-reviewed'
    where stimulus_version='study-v7-review-draft';
end; $$;
commit;
