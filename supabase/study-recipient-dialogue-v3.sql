-- Run after study-simulated-p02.sql on the existing study database.
-- Creates a new, unapproved P02 script version from the same three fixed products.
-- Existing attached trials, messages, events, and v2 stimuli are preserved.
begin;

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-web-v2' and approved_at is not null) <> 16 then
    raise exception 'P02_V2_STIMULI_REQUIRED';
  end if;
  if exists (
    select 1 from public.study_stimuli s
    where s.stimulus_version='birthday-friend-a-web-v2'
      and (jsonb_array_length(s.candidate_snapshots)<>3
        or s.candidate_snapshots->0->>'source_product_id' is distinct from 'study-fixed:cup'
        or (s.candidate_snapshots->0->>'price_krw')::integer is distinct from 32000
        or s.candidate_snapshots->1->>'source_product_id' is distinct from 'study-fixed:notebook'
        or (s.candidate_snapshots->1->>'price_krw')::integer is distinct from 28000
        or s.candidate_snapshots->2->>'source_product_id' is distinct from 'study-fixed:blanket'
        or (s.candidate_snapshots->2->>'price_krw')::integer is distinct from 42000
        or s.final_product_id is distinct from 'study-fixed:cup')
  ) then raise exception 'P02_FIXED_PRODUCTS_CHANGED'; end if;
end $$;

with source as (
  select s.profile_code,s.condition,s.final_product_id,
    jsonb_build_array(
      jsonb_set(s.candidate_snapshots->0,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 세라믹 머그 2개 세트라 함께 음료를 마시는 장면을 떠올릴 수 있습니다.',
        '• 일상에서 사용하는 컵이어서 생일 이후에도 쓰임이 분명합니다.',
        '• 32,000원으로 제시된 50,000원 예산 안에서 고를 수 있습니다.'))),
      jsonb_set(s.candidate_snapshots->1,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 노트 2권과 펜 1개가 한 세트라 바로 기록을 시작할 수 있습니다.',
        '• 하루의 생각이나 할 일을 적는 용도로 활용할 수 있습니다.',
        '• 28,000원으로 세 후보 중 가격이 가장 낮습니다.'))),
      jsonb_set(s.candidate_snapshots->2,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 실내에서 무릎에 덮어 쓰는 용도가 분명한 선물입니다.',
        '• 단색 담요라 강한 무늬 없이 생활 공간에 둘 수 있습니다.',
        '• 42,000원으로 제시된 50,000원 예산에 맞습니다.')))
    ) as candidate_snapshots
  from public.study_stimuli s
  where s.stimulus_version='birthday-friend-a-web-v2' and s.approved_at is not null
)
insert into public.study_stimuli(profile_code,condition,stimulus_version,origin,transcript,
  candidate_snapshots,final_product_id,approved_at,approved_by)
select s.profile_code,s.condition,'birthday-friend-a-dialogue-v3','scripted',
  jsonb_build_array(
    jsonb_build_object('phase','candidates','speaker','agent','kind','text','offset_ms',0,
      'content','친구 A가 당신의 생일 선물을 준비했습니다. 아래 대화는 친구 A의 실제 기록이 아닌 연구자가 구성한 장면입니다.')
  ) ||
  case when s.condition in ('A','C') then jsonb_build_array(
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','offset_ms',1000,
      'content','생일인 친구에게 줄 선물로 일상에서 쓸 수 있는 머그를 한 개 살펴봐줘. 예산은 5만 원 이하야.'),
    jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','offset_ms',4000,
      'content',format('%s은(는) %s원입니다. 세라믹 머그 2개 세트로 소개된 연구용 상품입니다.',
        s.candidate_snapshots->0->>'name_ko',to_char((s.candidate_snapshots->0->>'price_krw')::integer,'FM999,999')),
      'payload',jsonb_build_object('product',s.candidate_snapshots->0)),
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','offset_ms',7000,
      'content','가격과 2개 구성을 확인했어. 머그 세트를 첫 번째 후보에 담을게.',
      'payload',jsonb_build_object('product',s.candidate_snapshots->0)),
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','offset_ms',9000,
      'content','이번에는 일상을 기록할 수 있는 문구 선물을 한 개 살펴봐줘.'),
    jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','offset_ms',12000,
      'content',format('%s은(는) %s원입니다. 노트 2권과 펜 1개로 구성된 연구용 상품입니다.',
        s.candidate_snapshots->1->>'name_ko',to_char((s.candidate_snapshots->1->>'price_krw')::integer,'FM999,999')),
      'payload',jsonb_build_object('product',s.candidate_snapshots->1)),
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','offset_ms',15000,
      'content','노트와 펜 구성을 확인했어. 두 번째 후보에 담을게.',
      'payload',jsonb_build_object('product',s.candidate_snapshots->1)),
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','offset_ms',17000,
      'content','마지막으로 집에서 편하게 쓸 수 있는 담요를 한 개 살펴봐줘.'),
    jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','offset_ms',20000,
      'content',format('%s은(는) %s원입니다. 실내에서 무릎 위에 덮어 쓸 수 있는 단색 담요입니다.',
        s.candidate_snapshots->2->>'name_ko',to_char((s.candidate_snapshots->2->>'price_krw')::integer,'FM999,999')),
      'payload',jsonb_build_object('product',s.candidate_snapshots->2)),
    jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','offset_ms',23000,
      'content','담요의 용도와 가격을 확인했어. 세 번째 후보에 담을게.',
      'payload',jsonb_build_object('product',s.candidate_snapshots->2))
  ) else jsonb_build_array(
    jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_batch','offset_ms',4000,
      'content','예산 5만 원 안에서 세 후보의 상품 정보와 가격을 함께 보여드립니다. 친구 A가 세 상품을 확인합니다.',
      'payload',jsonb_build_object('candidates',s.candidate_snapshots))
  ) end ||
  case when s.condition in ('A','B') then jsonb_build_array(
    jsonb_build_object('phase','decision','speaker','giver','kind','text','offset_ms',0,
      'content','후보 세 개를 다 봤어. 가격과 구성을 한 번 비교해줄래? 마지막 선물은 내가 직접 고를게.'),
    jsonb_build_object('phase','decision','speaker','agent','kind','text','offset_ms',3000,
      'content',format('머그 세트는 %s원에 세라믹 머그 2개, 노트 세트는 %s원에 노트 2권과 펜 1개, 담요는 %s원에 실내용 담요 1개입니다. 모두 예산 5만 원 이내입니다.',
        to_char((s.candidate_snapshots->0->>'price_krw')::integer,'FM999,999'),
        to_char((s.candidate_snapshots->1->>'price_krw')::integer,'FM999,999'),
        to_char((s.candidate_snapshots->2->>'price_krw')::integer,'FM999,999'))),
    jsonb_build_object('phase','decision','speaker','giver','kind','text','offset_ms',6000,
      'content','머그 세트가 눈에 들어오네. 실제로 어떤 구성인지, 표시된 후기는 어떤 내용인지 다시 알려줘.'),
    jsonb_build_object('phase','decision','speaker','agent','kind','text','offset_ms',9000,
      'content','상품 정보에는 세라믹 머그 2개 세트로 적혀 있습니다. 손에 쥐기 편하고 차분한 색상이라는 문장은 연구용 예시 후기이며 실제 구매 후기는 아닙니다.'),
    jsonb_build_object('phase','decision','speaker','giver','kind','text','offset_ms',13000,
      'content','노트는 기록할 때 좋고 담요는 쉴 때 쓰기 좋겠어. 그래도 나는 두 개가 한 세트인 머그를 선물하고 싶어.'),
    jsonb_build_object('phase','decision','speaker','giver','kind','final_selection','offset_ms',17000,
      'content',format('노트 세트와 담요 대신 머그 세트를 최종 선물로 고르겠어. 세라믹 머그 2개 구성과 %s원 가격을 확인했고, 두 개를 함께 사용할 수 있다는 점을 선택 이유로 삼았어.',
        to_char((s.candidate_snapshots->0->>'price_krw')::integer,'FM999,999')),
      'payload',jsonb_build_object('source_product_id',s.final_product_id))
  ) else jsonb_build_array(
    jsonb_build_object('phase','decision','speaker','agent','kind','text','offset_ms',0,
      'content',format('세 후보를 비교했습니다. 머그 2개 세트 %s원, 노트 2권과 펜 1개 %s원, 단색 담요 %s원입니다.',
        to_char((s.candidate_snapshots->0->>'price_krw')::integer,'FM999,999'),
        to_char((s.candidate_snapshots->1->>'price_krw')::integer,'FM999,999'),
        to_char((s.candidate_snapshots->2->>'price_krw')::integer,'FM999,999'))),
    jsonb_build_object('phase','decision','speaker','agent','kind','final_selection','offset_ms',5000,
      'content',format('세라믹 머그 2개 세트를 최종 선물로 확정합니다. 노트 세트와 담요도 검토했으며, 확인된 2개 구성과 %s원 가격을 근거로 이 상품을 선택했습니다.',
        to_char((s.candidate_snapshots->0->>'price_krw')::integer,'FM999,999')),
      'payload',jsonb_build_object('source_product_id',s.final_product_id))
  ) end,
  s.candidate_snapshots,s.final_product_id,null,null
from source s
on conflict (profile_code,condition,stimulus_version) do update
set transcript=excluded.transcript,
    candidate_snapshots=excluded.candidate_snapshots,
    final_product_id=excluded.final_product_id
where public.study_stimuli.approved_at is null
  and not exists(select 1 from public.study_trials t where t.stimulus_id=public.study_stimuli.id);

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-dialogue-v3')<>16 then
    raise exception 'P02_V3_STIMULI_NOT_COMPLETE';
  end if;
  if exists (
    select 1 from public.study_stimuli old
    join public.study_stimuli v3 on v3.profile_code=old.profile_code and v3.condition=old.condition
    where old.stimulus_version='birthday-friend-a-web-v2'
      and v3.stimulus_version='birthday-friend-a-dialogue-v3'
      and ((select jsonb_agg(item - 'reason' order by position)
            from jsonb_array_elements(v3.candidate_snapshots) with ordinality as candidate(item,position))
           <>(select jsonb_agg(item - 'reason' order by position)
            from jsonb_array_elements(old.candidate_snapshots) with ordinality as candidate(item,position))
        or v3.final_product_id<>old.final_product_id
        or (v3.condition in ('A','B') and
          (select count(*) from jsonb_array_elements(v3.transcript) as msg(value)
           where msg.value->>'phase'='decision')<6))
  ) then raise exception 'P02_V3_CONTROL_OR_DIALOGUE_MISMATCH'; end if;
end $$;

-- The installed enrollment RPC still inserts v2 explicitly. Override only new
-- recipient trial inserts; keep already started or attached trials on their version.
create or replace function public.study_target_recipient_dialogue_v3()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='recipient' and new.stimulus_version_target in
      ('birthday-friend-a-web-v1','birthday-friend-a-web-v2') then
    new.stimulus_version_target:='birthday-friend-a-dialogue-v3';
  end if;
  return new;
end $$;
drop trigger if exists study_trials_recipient_dialogue_version on public.study_trials;
create trigger study_trials_recipient_dialogue_version before insert on public.study_trials
for each row execute function public.study_target_recipient_dialogue_v3();
revoke all on function public.study_target_recipient_dialogue_v3() from public,anon,authenticated;

update public.study_trials set stimulus_version_target='birthday-friend-a-dialogue-v3'
where role='recipient' and phase='locked' and stimulus_id is null
  and stimulus_version_target in ('birthday-friend-a-web-v1','birthday-friend-a-web-v2');

commit;

-- Review all four scripts in /admin, then approve before starting a new P02 condition.
select condition, count(*) as scripts, min(approved_at) as approved_at
from public.study_stimuli where stimulus_version='birthday-friend-a-dialogue-v3'
group by condition order by condition;
