-- Run only after the researcher has reviewed every v4 product and observation
-- transcript in Supabase. Approval freezes the four recipient stimuli.
begin;
do $$
declare approved_count integer;
begin
  if (select count(*) from public.product_catalog
      where dataset_version='walmart-2024-08-curated-v2'
        and review_status='pending' and not experiment_eligible
        and is_active and not is_mock and price_experiment between 0 and 50000
        and currency_experiment='KRW' and currency_original='USD'
        and price_original is not null and fx_rate_version is not null
        and image_url like 'https://%')<>12 then
    raise exception 'V4_PRODUCTS_NOT_READY: review all 12 source images, prices, names and specifications.';
  end if;

  if (select count(*) from public.recipient_stimuli
      where id in ('gift-scenario-R1v2-v2','gift-scenario-R2v2-v2',
                   'gift-scenario-R3v2-v2','gift-scenario-R4v2-v2')
        and review_status='pending' and frozen_at is null
        and source_kind='researcher_scripted'
        and jsonb_array_length(candidate_snapshots)=3
        and (select count(distinct item->>'source_product_id')
             from jsonb_array_elements(candidate_snapshots) item)=3
        and final_source_product_id=candidate_snapshots->0->>'source_product_id')<>4 then
    raise exception 'V4_STIMULI_NOT_READY: review each three-product set, final product and transcript.';
  end if;

  if exists (
    select 1 from public.recipient_stimuli s,
      lateral jsonb_array_elements(s.candidate_snapshots) item
      left join public.product_catalog p
        on p.dataset_version='walmart-2024-08-curated-v2'
       and p.source_product_id=item->>'source_product_id'
    where s.id in ('gift-scenario-R1v2-v2','gift-scenario-R2v2-v2',
                   'gift-scenario-R3v2-v2','gift-scenario-R4v2-v2')
      and (p.id is null or not (p.profile_codes @> array[s.profile_code])
        or p.price_experiment<>(item->>'price')::numeric
        or p.image_url is distinct from item->>'image_url'
        or p.product_name_original is distinct from item->>'product_name_original')
  ) then
    raise exception 'V4_SNAPSHOT_MISMATCH: frozen product details differ from reviewed catalog rows.';
  end if;

  update public.product_catalog
  set experiment_eligible=true,review_status='reviewed',updated_at=now()
  where dataset_version='walmart-2024-08-curated-v2'
    and review_status='pending' and not experiment_eligible;
  get diagnostics approved_count = row_count;
  if approved_count<>12 then raise exception 'V4_PRODUCT_APPROVAL_INCOMPLETE'; end if;

  update public.recipient_stimuli
  set review_status='approved',frozen_at=now()
  where id in ('gift-scenario-R1v2-v2','gift-scenario-R2v2-v2',
               'gift-scenario-R3v2-v2','gift-scenario-R4v2-v2')
    and review_status='pending';
  get diagnostics approved_count = row_count;
  if approved_count<>4 then raise exception 'V4_STIMULUS_APPROVAL_INCOMPLETE'; end if;
end $$;
commit;
