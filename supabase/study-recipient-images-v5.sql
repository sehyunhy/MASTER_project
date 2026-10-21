-- Apply once after study-recipient-reviews-v4.sql; keep all existing participant rows.
-- The three local photos are research stimuli served from public/stimuli in the app.
-- Deploy the matching app commit before approving/starting a v5 recipient trial.
begin;

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-reviews-v4') <> 16 then
    raise exception 'P02_V4_STIMULI_REQUIRED';
  end if;
end $$;

insert into public.study_products(source_product_id,dataset_version,profile_codes,
  name_original,name_ko,description_original,image_url,category,price_original_usd,
  price_krw,fx_rule,source_url,reviewed)
values
  ('study-fixed:v5-mug','study-simulated-fixed-v5',array['R1','R2','R3','R4'],
    '머그컵 세트','머그컵 세트','파란색 무늬가 다른 세라믹 머그컵 2개로 구성된 연구용 선물입니다.',
    '/stimuli/p02-mug-set.png','머그컵',0,32000,'simulated_krw_price',null,true),
  ('study-fixed:v5-diary','study-simulated-fixed-v5',array['R1','R2','R3','R4'],
    '다이어리 펜 세트','다이어리 펜 세트','연보라색 다이어리 1권과 펜 1개로 구성된 연구용 선물입니다.',
    '/stimuli/p02-diary-pen-set.png','문구',0,28000,'simulated_krw_price',null,true),
  ('study-fixed:v5-blanket','study-simulated-fixed-v5',array['R1','R2','R3','R4'],
    '담요','담요','주황색 체크무늬의 무릎담요 1개입니다. 실내에서 덮어 쓸 수 있는 연구용 선물입니다.',
    '/stimuli/p02-blanket.png','생활 소품',0,42000,'simulated_krw_price',null,true)
on conflict (source_product_id) do nothing;

do $$
begin
  if (select count(*) from public.study_products
      where dataset_version='study-simulated-fixed-v5' and reviewed
        and source_product_id in ('study-fixed:v5-mug','study-fixed:v5-diary','study-fixed:v5-blanket')) <> 3 then
    raise exception 'P02_V5_PRODUCTS_MISSING';
  end if;
  if exists (
    select 1 from public.study_products p
    where p.source_product_id in ('study-fixed:v5-mug','study-fixed:v5-diary','study-fixed:v5-blanket')
      and (p.name_ko,p.image_url) is distinct from
        (case p.source_product_id
           when 'study-fixed:v5-mug' then '머그컵 세트'
           when 'study-fixed:v5-diary' then '다이어리 펜 세트'
           else '담요' end,
         case p.source_product_id
           when 'study-fixed:v5-mug' then '/stimuli/p02-mug-set.png'
           when 'study-fixed:v5-diary' then '/stimuli/p02-diary-pen-set.png'
           else '/stimuli/p02-blanket.png' end)
  ) then raise exception 'P02_V5_PRODUCT_CONFLICT'; end if;
end $$;

with fixed as (
  select jsonb_agg(jsonb_build_object(
    'source_product_id',p.source_product_id,'name_ko',p.name_ko,'name_original',p.name_original,
    'description_original',p.description_original,'image_url',p.image_url,'category',p.category,
    'price_krw',p.price_krw,'price_original_usd',p.price_original_usd,
    'source_url',p.source_url,'dataset_version',p.dataset_version,
    'reason',case p.source_product_id
      when 'study-fixed:v5-mug' then concat_ws(E'\n',
        '• 서로 다른 파란색 무늬의 머그컵 두 개가 한 세트입니다.',
        '• 두 사람이 음료를 마실 때 함께 사용할 수 있습니다.',
        '• 32,000원으로 50,000원 예산 안에 들어갑니다.')
      when 'study-fixed:v5-diary' then concat_ws(E'\n',
        '• 다이어리와 펜이 함께 있어 바로 기록을 시작할 수 있습니다.',
        '• 일정이나 하루의 생각을 적는 데 쓸 수 있습니다.',
        '• 28,000원으로 세 후보 중 가격이 가장 낮습니다.')
      when 'study-fixed:v5-blanket' then concat_ws(E'\n',
        '• 집에서 쉬거나 책을 읽을 때 무릎에 덮을 수 있습니다.',
        '• 주황색 체크무늬가 눈에 띄는 선물입니다.',
        '• 42,000원으로 50,000원 예산 안에 들어갑니다.') end,
    'example_review_display',case p.source_product_id
      when 'study-fixed:v5-mug' then '컵 두 개를 번갈아 쓰고 있어요. 친구가 왔을 때 같은 세트로 음료를 낼 수 있고, 파란 무늬가 서로 달라 각자 컵을 구분하기도 편해요.'
      when 'study-fixed:v5-diary' then '펜이 같이 들어 있어서 받자마자 일정부터 적었어요. 다이어리는 가방에 넣고 다니며 짧게 메모하기 좋았어요.'
      when 'study-fixed:v5-blanket' then '소파에 앉아 있을 때 무릎에 덮어 쓰고 있어요. 주황색 체크무늬가 선명해서 방에 두었을 때도 눈에 잘 띄어요.' end
  ) order by array_position(array['study-fixed:v5-mug','study-fixed:v5-diary','study-fixed:v5-blanket'],p.source_product_id)) as candidates
  from public.study_products p
  where p.source_product_id in ('study-fixed:v5-mug','study-fixed:v5-diary','study-fixed:v5-blanket')
    and p.dataset_version='study-simulated-fixed-v5' and p.reviewed
), revised as (
  select s.profile_code,s.condition,s.transcript,f.candidates
  from public.study_stimuli s cross join fixed f
  where s.stimulus_version='birthday-friend-a-reviews-v4'
    and jsonb_array_length(f.candidates)=3
), messages as (
  select r.profile_code,r.condition,r.candidates,m.position,
    case
      when m.value->>'kind' in ('candidate_proposal','candidate_confirmed') then
        jsonb_set(m.value,'{payload,product}',
          case m.value#>>'{payload,product,source_product_id}'
            when 'study-fixed:cup' then r.candidates->0
            when 'study-fixed:notebook' then r.candidates->1
            when 'study-fixed:blanket' then r.candidates->2
            else m.value#>'{payload,product}' end)
      when m.value->>'kind'='candidate_batch' then
        jsonb_set(m.value,'{payload,candidates}',r.candidates)
      when m.value->>'kind'='final_selection' then
        jsonb_set(m.value,'{payload,source_product_id}',to_jsonb('study-fixed:v5-mug'::text))
      else m.value end as payload_updated,
    case when m.value->>'phase'='decision' and m.value->>'speaker'='agent'
      and m.value->>'kind'='text' and m.value->>'offset_ms'='9000' then
      '머그컵 두 개가 한 세트입니다. 예시 후기에는 친구와 함께 쓸 때 각자 컵을 구분하기 좋았다고 적혀 있어요.'
    else replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      m.value->>'content',
      '친구와 나누는 세라믹 머그 세트','머그컵 세트'),
      '하루 기록 노트와 펜 세트','다이어리 펜 세트'),
      '포근한 무릎담요','담요'),
      '노트 2권과 펜 1개','다이어리 1권과 펜 1개'),
      '노트 2권','다이어리 1권'),
      '노트 세트','다이어리 펜 세트'),
      '단색 담요','체크무늬 담요'),
      '머그 세트','머그컵 세트'),
      '연구용 상품','선물 후보'),
      '연구용 후보','선물 후보'),
      '노트와 펜','다이어리와 펜'),
      '노트는','다이어리는') end as content_updated
  from revised r cross join lateral jsonb_array_elements(r.transcript)
    with ordinality as m(value,position)
), assembled as (
  select profile_code,condition,candidates,
    jsonb_agg(jsonb_set(payload_updated,'{content}',to_jsonb(content_updated))
      order by position) as transcript
  from messages group by profile_code,condition,candidates
)
insert into public.study_stimuli(profile_code,condition,stimulus_version,origin,
  transcript,candidate_snapshots,final_product_id,approved_at,approved_by)
select profile_code,condition,'birthday-friend-a-images-v5','scripted',transcript,
  candidates,'study-fixed:v5-mug',null,null from assembled
on conflict (profile_code,condition,stimulus_version) do nothing;

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-images-v5') <> 16 then
    raise exception 'P02_V5_STIMULI_NOT_COMPLETE';
  end if;
  if exists (
    select 1 from public.study_stimuli s
    where s.stimulus_version='birthday-friend-a-images-v5'
      and (s.candidate_snapshots->0->>'source_product_id' is distinct from 'study-fixed:v5-mug'
        or s.candidate_snapshots->1->>'source_product_id' is distinct from 'study-fixed:v5-diary'
        or s.candidate_snapshots->2->>'source_product_id' is distinct from 'study-fixed:v5-blanket'
        or s.final_product_id is distinct from 'study-fixed:v5-mug')
  ) then raise exception 'P02_V5_PRODUCTS_CHANGED'; end if;
end $$;

create or replace function public.study_target_recipient_images_v5()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='recipient' and new.stimulus_version_target in
      ('birthday-friend-a-web-v1','birthday-friend-a-web-v2',
       'birthday-friend-a-dialogue-v3','birthday-friend-a-reviews-v4') then
    new.stimulus_version_target:='birthday-friend-a-images-v5';
  end if;
  return new;
end $$;
drop trigger if exists study_trials_recipient_dialogue_version on public.study_trials;
drop trigger if exists study_trials_recipient_reviews_version on public.study_trials;
drop trigger if exists study_trials_recipient_images_version on public.study_trials;
create trigger study_trials_recipient_images_version before insert on public.study_trials
for each row execute function public.study_target_recipient_images_v5();
revoke all on function public.study_target_recipient_images_v5() from public,anon,authenticated;

update public.study_trials set stimulus_version_target='birthday-friend-a-images-v5'
where role='recipient' and phase='locked' and stimulus_id is null
  and stimulus_version_target in
    ('birthday-friend-a-web-v1','birthday-friend-a-web-v2',
     'birthday-friend-a-dialogue-v3','birthday-friend-a-reviews-v4');

commit;

-- Approve the 16 v5 scripts in /admin before entering a new P02 condition.
select condition,count(*) as scripts,min(approved_at) as approved_at
from public.study_stimuli where stimulus_version='birthday-friend-a-images-v5'
group by condition order by condition;
