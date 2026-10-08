-- Researcher review required. Run in Supabase SQL Editor only after the 2024-08
-- Walmart CSV has been imported and the study's fixed USD/KRW rule was approved.
-- This creates new profiles, 12 curated catalog rows, pending observation
-- stimuli and P081-P160 assignments. It does not change v1 observations.
begin;

create temporary table v4_product_selection (
  profile_code text not null,
  display_order integer not null,
  source_product_id text primary key,
  korean_name text not null,
  tags_ko text[] not null,
  fit_tags text[] not null,
  fit_reason text not null,
  unique(profile_code, display_order)
) on commit drop;

insert into v4_product_selection values
('R1v2',1,'3440558193','코코카인드 비타민 C 세럼',array['스킨케어','일상 관리'],array['skincare','daily'],'집에서 사용하는 스킨케어 제품에 대한 관심사와 관련이 있습니다.'),
('R1v2',2,'46280772','오키프스 워킹 핸즈 핸드크림 3온스',array['스킨케어','일상 관리'],array['skincare','daily'],'일상에서 사용하는 손 관리 제품에 대한 관심사와 관련이 있습니다.'),
('R1v2',3,'2010024322','솝박스 워터멜론·피오니 바디워시 20온스',array['세정','일상 관리'],array['body-care','daily'],'집에서 사용하는 세정 제품에 대한 관심사와 관련이 있습니다.'),
('R2v2',1,'1093743201','엑스클루시보 메즐라 킹사이즈 플리스 담요',array['집에서 쉬는 시간','패브릭'],array['home','rest','textile'],'집에서 쉬는 시간에 사용하는 패브릭 제품과 관련이 있습니다.'),
('R2v2',2,'1097677016','페더 앤 스티치 표준형 면 베갯잇 2개',array['집에서 쉬는 시간','패브릭'],array['home','rest','textile'],'집에서 사용하는 침구 소품과 관련이 있습니다.'),
('R2v2',3,'891036133','16인치 수제 면 쿠션 커버',array['집에서 쉬는 시간','패브릭'],array['home','rest','textile'],'집에서 사용하는 패브릭 소품과 관련이 있습니다.'),
('R3v2',1,'973604797','갤러리 솔루션 8×10인치 사진 액자',array['사진 기록','공간 꾸미기'],array['photo','decor','home'],'사진을 전시하는 관심사와 관련이 있습니다.'),
('R3v2',2,'3511393855','럭스 위버스 2×3피트 베이지 러그',array['공간 꾸미기'],array['decor','home'],'작은 공간을 꾸미는 관심사와 관련이 있습니다.'),
('R3v2',3,'1825469871','식스홈 17×30인치 현관 매트',array['공간 꾸미기'],array['decor','home'],'집의 작은 공간을 꾸미는 관심사와 관련이 있습니다.'),
('R4v2',1,'10308385','올드베이 클래식 시즈닝 6온스',array['요리'],array['cooking','home'],'집에서 요리하는 관심사와 관련이 있습니다.'),
('R4v2',2,'36995775','대시 오리지널 무염 시즈닝 21온스',array['요리'],array['cooking','home'],'집에서 요리하는 관심사와 관련이 있습니다.'),
('R4v2',3,'864008591','DII 네이비 블루 14×72인치 테이블 러너',array['식탁'],array['dining','home'],'식탁을 꾸미는 관심사와 관련이 있습니다.');

-- Some v4 participant codes may already have been created by seed:assignments.
-- Reuse only exact matches; never overwrite an existing participant or trial.
create temporary table v4_expected_assignments on commit drop as
with roles(role,code_offset) as (values ('giver',80),('recipient',120)),
slots as (
  select role,code_offset,n,
    case when n<=20 then 'high' else 'low' end as intimacy,
    case when n<=20 then n-1 else n-21 end as within_cell
  from roles cross join generate_series(1,40) n
)
select 'P'||lpad((n+code_offset)::text,3,'0') as participant_code,
  role, intimacy as intimacy_condition,
  'S'||(floor(within_cell::numeric/5)::integer+1)::text as sequence_id,
  (case when mod(within_cell,5)<4 then mod(within_cell,5)
    when intimacy='high' then 0 else 1 end)::smallint as profile_rotation_offset
from slots;

-- Fail the entire transaction when an exact source row is missing or over budget.
do $$
declare invalid_count integer; conflicting_codes text;
begin
  select count(*) into invalid_count
  from v4_product_selection s left join public.product_catalog p
    on p.dataset_version='walmart-2024-08-v1' and p.source_product_id=s.source_product_id
  where p.id is null or p.source_type is distinct from 'walmart_csv_snapshot'
    or p.is_mock is distinct from false or p.is_active is distinct from true
    or p.product_name_original is null or p.price_experiment is null
    or p.price_experiment>50000 or p.price_experiment<0
    or p.currency_experiment is distinct from 'KRW'
    or p.currency_original is distinct from 'USD'
    or p.price_original is null or p.fx_rate_version is null
    or p.image_url is null or p.image_url not like 'https://%';
  if invalid_count<>0 then
    raise exception 'V4_SOURCE_INVALID: % selected rows missing, over 50000 KRW or incomplete. Review source prices/images and the fixed exchange rule.', invalid_count;
  end if;
  select string_agg(e.participant_code, ', ' order by e.participant_code)
    into conflicting_codes
  from v4_expected_assignments e
  join public.participants p using (participant_code)
  where p.role is distinct from e.role
    or p.intimacy_condition is distinct from e.intimacy_condition
    or p.sequence_id is distinct from e.sequence_id
    or p.profile_rotation_offset is distinct from e.profile_rotation_offset
    or p.experiment_version is distinct from '4.0.0'
    or p.is_mock is distinct from false;
  if conflicting_codes is not null then
    raise exception 'V4_CODES_CONFLICT: %. Existing assignments were not changed.', conflicting_codes;
  end if;
end $$;

insert into public.recipient_profiles
(id,profile_code,name,age,occupation,hobbies,recent_interest,preference,dislike,lifestyle_context,gift_budget,gift_occasion,version)
values
('R1v2','R1v2','민서',29,'서비스 기획자','["일상 관리","스킨케어"]'::jsonb,'집에서 쓰는 스킨케어와 세정 제품에 관심이 있습니다.','일상에서 부담 없이 사용할 수 있는 물건을 선호합니다.','관리 과정이 복잡한 제품은 선호하지 않습니다.','평일에는 도심에서 생활하고 집에서 일상 관리 시간을 보냅니다.',50000,'생일','profiles-v2'),
('R2v2','R2v2','지훈',31,'편집자','["독서","집에서 쉬는 시간"]'::jsonb,'집에서 책을 읽고 휴식을 취하는 공간에 관심이 있습니다.','집에서 자주 사용할 수 있는 패브릭 소품을 선호합니다.','향이 지나치게 강한 제품은 선호하지 않습니다.','집에서 보내는 시간이 많고 조용한 여가를 즐깁니다.',50000,'감사 선물','profiles-v2'),
('R3v2','R3v2','서연',27,'마케터','["사진 기록","작은 공간 꾸미기"]'::jsonb,'찍은 사진을 전시하고 집의 작은 공간을 꾸미는 데 관심이 있습니다.','공간에 어울리는 소품을 선호합니다.','지나치게 큰 물건은 선호하지 않습니다.','주말에 사진을 정리하고 집의 공간을 꾸밉니다.',50000,'생일','profiles-v2'),
('R4v2','R4v2','도윤',30,'연구원','["요리","식탁 꾸미기"]'::jsonb,'집에서 간단한 요리를 만들고 식탁을 꾸미는 데 관심이 있습니다.','실용적이면서 디자인이 단정한 물건을 선호합니다.','보관과 세척이 번거로운 제품은 선호하지 않습니다.','평일 저녁과 주말에 집에서 식사를 준비합니다.',50000,'감사 선물','profiles-v2')
on conflict (id) do nothing;

insert into public.product_catalog
(sku,source_product_id,product_name,product_name_original,product_name_ko,brand,category,
 price,currency,price_original,currency_original,price_experiment,currency_experiment,fx_rate_version,
 description,description_original,description_ko,image_url,image_source,image_urls,specifications,categories,
 search_tags_ko,fit_tags,profile_codes,use_cases,strengths,limitations,care_requirements,
 source,source_type,source_url,source_timestamp,source_timestamp_raw,dataset_version,version,
 is_mock,is_active,experiment_eligible,review_status,raw_record,import_issues)
select 'WM-V4-'||p.source_product_id,p.source_product_id,s.korean_name,p.product_name_original,s.korean_name,
 p.brand,p.category,p.price,p.currency,p.price_original,p.currency_original,p.price_experiment,p.currency_experiment,p.fx_rate_version,
 p.description,p.description_original,p.description_ko,p.image_url,p.image_source,p.image_urls,p.specifications,p.categories,
 s.tags_ko,s.fit_tags,array[s.profile_code],array[s.fit_reason],p.strengths,p.limitations,p.care_requirements,
 p.source,p.source_type,p.source_url,p.source_timestamp,p.source_timestamp_raw,'walmart-2024-08-curated-v2','walmart-2024-08-curated-v2',
 false,true,false,'pending',p.raw_record,p.import_issues
from v4_product_selection s join public.product_catalog p
  on p.dataset_version='walmart-2024-08-v1' and p.source_product_id=s.source_product_id
on conflict (sku) do nothing;

-- Insert only missing slots; matching P081-P160 rows are kept as they are.
insert into public.participants
(participant_code,role,intimacy_condition,sequence_id,profile_rotation_offset,status,experiment_version,is_mock)
select e.participant_code,e.role,e.intimacy_condition,e.sequence_id,
  e.profile_rotation_offset,'assigned','4.0.0',false
from v4_expected_assignments e
where not exists (select 1 from public.participants p where p.participant_code=e.participant_code)
on conflict (participant_code) do nothing;

-- One frozen candidate set per profile. The same set and final source ID are
-- reused in C1-C4. These rows start pending and cannot be shown until approved.
with snapshots as (
  select s.profile_code,s.display_order,p.source_product_id,
    jsonb_build_object(
      'id',p.id,'source_product_id',p.source_product_id,'sku',p.sku,
      'product_name',coalesce(p.product_name_ko,p.product_name_original),
      'product_name_original',p.product_name_original,'brand',p.brand,'category',p.category,
      'price',p.price_experiment,'currency',p.currency_experiment,
      'price_original',p.price_original,'currency_original',p.currency_original,
      'fx_rate_version',p.fx_rate_version,'description',coalesce(p.description_ko,p.description),
      'description_original',p.description_original,'image_url',p.image_url,
      'specifications',p.specifications,'source_url',p.source_url,
      'source_timestamp',p.source_timestamp_raw,'dataset_version',p.dataset_version,
      'use_cases',p.use_cases,'strengths','[]'::jsonb,'limitations','[]'::jsonb,
      'care_requirements',null,'fit_reason',s.fit_reason,'source_type',p.source_type,'is_mock',false
    ) as item
  from v4_product_selection s join public.product_catalog p
    on p.dataset_version='walmart-2024-08-curated-v2' and p.source_product_id=s.source_product_id
), grouped as (
  select profile_code,jsonb_agg(item order by display_order) as candidates,
    max(source_product_id) filter(where display_order=1) as final_source_product_id,
    count(*) as item_count
  from snapshots group by profile_code
)
insert into public.recipient_stimuli
(id,scenario_id,profile_code,version,source_kind,source_note,candidate_snapshots,
 final_source_product_id,transcript,candidate_set_hash,review_status)
select 'gift-scenario-'||profile_code||'-v2','gift-scenario-'||profile_code,profile_code,2,
  'researcher_scripted','연구자가 구성한 시나리오; 사용자 제공 2024-08 Walmart CSV 스냅샷',
  candidates,final_source_product_id,
  jsonb_build_object(
    'criteria_dropdown','선택해서 입력하기 · 상품 카테고리: 전체 · 중요 기준: 실용성',
    'criteria_category','전체','criteria_priority','실용성',
    'criteria_giver','이 사람의 관심사와 50,000원 예산에 맞는 선물을 살펴보고 싶어요.',
    'criteria_agent','제공된 기준과 기록된 상품 정보로 후보를 확인하겠습니다.',
    'request_candidates','이 기준으로 선물 후보를 찾아주세요.',
    'candidate_agent','기록된 상품에서 세 후보를 구성했습니다.',
    'request_comparison','세 후보를 같은 기준으로 비교해주세요.',
    'comparison_agent','원본 상품 정보와 고정된 실험 가격을 비교했습니다. 기록에 없는 특성은 정보 없음으로 표시합니다.',
    'giver_decision','첫 번째 후보로 할게요.',
    'agent_decision','표시된 후보 중 첫 번째 후보를 최종 선물로 결정했습니다.'
  ),encode(digest(candidates::text,'sha256'),'hex'),'pending'
from grouped where item_count=3
on conflict (id) do nothing;

-- Check the expected new rows before committing; any failure rolls back all.
do $$
begin
  if (select count(*) from public.recipient_profiles where version='profiles-v2')<>4
    or (select count(*) from public.product_catalog where dataset_version='walmart-2024-08-curated-v2' and review_status='pending' and not experiment_eligible)<>12
    or (select count(*) from public.recipient_stimuli where id like 'gift-scenario-R%v2-v2' and review_status='pending')<>4
    or (select count(*) from public.participants where experiment_version='4.0.0' and participant_code between 'P081' and 'P160')<>80 then
    raise exception 'V4_PREPARATION_INCOMPLETE: expected 4 profiles, 12 curated products, 4 pending stimuli, 80 assignments';
  end if;
end $$;
commit;

-- Review pending rows and prices in the Supabase Table Editor before running
-- approve-walmart-v4.sql. Approved stimuli cannot be edited later.
