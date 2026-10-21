-- Apply after study-recipient-dialogue-v3.sql. Preserve attached trials and old stimuli.
-- P02 v4 keeps the same products, final gift, and scripted dialogue. It adds the
-- three visible recommendation reasons and first-person fictional review text.
begin;

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-dialogue-v3')<>16 then
    raise exception 'P02_V3_STIMULI_REQUIRED';
  end if;
  if exists (
    select 1 from public.study_stimuli s
    where s.stimulus_version='birthday-friend-a-dialogue-v3'
      and (s.candidate_snapshots->0->>'source_product_id' is distinct from 'study-fixed:cup'
        or (s.candidate_snapshots->0->>'price_krw')::integer is distinct from 32000
        or s.candidate_snapshots->1->>'source_product_id' is distinct from 'study-fixed:notebook'
        or (s.candidate_snapshots->1->>'price_krw')::integer is distinct from 28000
        or s.candidate_snapshots->2->>'source_product_id' is distinct from 'study-fixed:blanket'
        or (s.candidate_snapshots->2->>'price_krw')::integer is distinct from 42000
        or s.final_product_id is distinct from 'study-fixed:cup')
  ) then raise exception 'P02_FIXED_PRODUCTS_CHANGED'; end if;
end $$;

with revised as (
  select s.profile_code,s.condition,s.final_product_id,s.transcript,
    jsonb_build_array(
      jsonb_set(jsonb_set(s.candidate_snapshots->0,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 세라믹 머그 2개 세트라 함께 음료를 마시는 장면을 떠올릴 수 있습니다.',
        '• 일상에서 사용하는 컵이어서 생일 이후에도 쓰임이 분명합니다.',
        '• 32,000원으로 제시된 50,000원 예산 안에서 고를 수 있습니다.'))),
        '{example_review_display}',to_jsonb('머그가 두 개라 집에 친구가 왔을 때 같이 꺼내 쓰기 좋았어요. 색이 차분해서 식탁 위에 두어도 잘 어울리고, 손잡이도 편해서 아침마다 쓰게 됩니다.'::text)),
      jsonb_set(jsonb_set(s.candidate_snapshots->1,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 노트 2권과 펜 1개가 한 세트라 바로 기록을 시작할 수 있습니다.',
        '• 하루의 생각이나 할 일을 적는 용도로 활용할 수 있습니다.',
        '• 28,000원으로 세 후보 중 가격이 가장 낮습니다.'))),
        '{example_review_display}',to_jsonb('책상에 두고 하루에 몇 줄씩 적고 있어요. 종이가 부드러워 쓰기 편하고, 두 권이라 한 권은 일기용, 다른 한 권은 메모용으로 나눠 쓰기 좋았습니다.'::text)),
      jsonb_set(jsonb_set(s.candidate_snapshots->2,'{reason}',to_jsonb(concat_ws(E'\n',
        '• 실내에서 무릎에 덮어 쓰는 용도가 분명한 선물입니다.',
        '• 단색 담요라 강한 무늬 없이 생활 공간에 둘 수 있습니다.',
        '• 42,000원으로 제시된 50,000원 예산에 맞습니다.'))),
        '{example_review_display}',to_jsonb('집에서 책 읽을 때 무릎에 덮고 있어요. 필요할 때 가볍게 꺼내 쓰기 좋고, 단색이라 소파 옆에 두어도 눈에 거슬리지 않았어요.'::text))
    ) as candidates
  from public.study_stimuli s
  where s.stimulus_version='birthday-friend-a-dialogue-v3'
), prepared as (
  select r.profile_code,r.condition,r.final_product_id,r.candidates,
    (select jsonb_agg(
      case
        when message.value->>'phase'='decision' and message.value->>'speaker'='agent'
          and message.value->>'kind'='text' and message.value->>'offset_ms'='9000' then
          jsonb_set(message.value,'{content}',to_jsonb(
            '머그는 세라믹 2개 세트예요. 사용 후기 예시에는 손잡이가 편하고 차분한 색상이라 자주 꺼내 쓴다고 적혀 있어요.'::text))
        when message.value->>'kind' in ('candidate_proposal','candidate_confirmed') then
          jsonb_set(message.value,'{payload,product}',coalesce(
            (select choice.product from jsonb_array_elements(r.candidates) as choice(product)
             where choice.product->>'source_product_id'=message.value#>>'{payload,product,source_product_id}' limit 1),
            message.value#>'{payload,product}'))
        when message.value->>'kind'='candidate_batch' then
          jsonb_set(message.value,'{payload,candidates}',r.candidates)
        else message.value
      end order by message.position)
     from jsonb_array_elements(r.transcript) with ordinality as message(value,position)) as transcript
  from revised r
)
insert into public.study_stimuli(profile_code,condition,stimulus_version,origin,transcript,
  candidate_snapshots,final_product_id,approved_at,approved_by)
select profile_code,condition,'birthday-friend-a-reviews-v4','scripted',transcript,
  candidates,final_product_id,null,null from prepared
on conflict (profile_code,condition,stimulus_version) do nothing;

do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-reviews-v4')<>16 then
    raise exception 'P02_V4_STIMULI_NOT_COMPLETE';
  end if;
  if exists (
    select 1 from public.study_stimuli s
    where s.stimulus_version='birthday-friend-a-reviews-v4'
      and (jsonb_array_length(s.candidate_snapshots)<>3
        or s.final_product_id is distinct from 'study-fixed:cup'
        or exists (select 1 from jsonb_array_elements(s.candidate_snapshots) as product(value)
          where array_length(regexp_split_to_array(product.value->>'reason',E'\n'),1) is distinct from 3
            or product.value->>'example_review_display' is null))
  ) then raise exception 'P02_V4_REASONS_OR_REVIEWS_MISSING'; end if;
end $$;

create or replace function public.study_target_recipient_reviews_v4()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='recipient' and new.stimulus_version_target in
      ('birthday-friend-a-web-v1','birthday-friend-a-web-v2','birthday-friend-a-dialogue-v3') then
    new.stimulus_version_target:='birthday-friend-a-reviews-v4';
  end if;
  return new;
end $$;
drop trigger if exists study_trials_recipient_dialogue_version on public.study_trials;
drop trigger if exists study_trials_recipient_reviews_version on public.study_trials;
create trigger study_trials_recipient_reviews_version before insert on public.study_trials
for each row execute function public.study_target_recipient_reviews_v4();
revoke all on function public.study_target_recipient_reviews_v4() from public,anon,authenticated;

update public.study_trials set stimulus_version_target='birthday-friend-a-reviews-v4'
where role='recipient' and phase='locked' and stimulus_id is null
  and stimulus_version_target in
    ('birthday-friend-a-web-v1','birthday-friend-a-web-v2','birthday-friend-a-dialogue-v3');

commit;

-- Review and approve all 16 v4 stimuli in /admin before starting a P02 trial.
select condition,count(*) as scripts,min(approved_at) as approved_at
from public.study_stimuli where stimulus_version='birthday-friend-a-reviews-v4'
group by condition order by condition;
