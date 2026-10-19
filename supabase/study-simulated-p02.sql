-- Existing study-fresh DB only. Preserves people, trials, messages and events.
-- These are fictional research products, images and example reviews, not seller data.
-- Replaces only unapproved P02 v2 stimuli not attached to any trial.
begin;
insert into public.study_products(source_product_id,dataset_version,profile_codes,name_original,name_ko,
  description_original,image_url,category,price_original_usd,price_krw,fx_rule,source_url,reviewed)
values
  ('study-fixed:cup','study-simulated-fixed-v1',array['R1','R2','R3','R4']::text[],'친구와 나누는 세라믹 머그 세트','친구와 나누는 세라믹 머그 세트','연구용 가상 상품입니다. 상품 정보: 일상에서 사용할 수 있는 세라믹 머그 2개 세트입니다. 연구용 예시 후기(실제 구매 후기 아님): 손에 쥐기 편하고 색상이 차분해서 자주 사용했다는 예시 의견입니다.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzIwIDMwMCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIzMDAiIHJ4PSIyNCIgZmlsbD0iI2VlZjRmZiIvPjxwYXRoIGQ9Ik0xMDAgODZoMTA1djkzYTQwIDQwIDAgMCAxLTQwIDQwaC0yNWE0MCA0MCAwIDAgMS00MC00MHoiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzRiNjM4YyIgc3Ryb2tlLXdpZHRoPSI4Ii8+PHBhdGggZD0iTTIwNSAxMDNoMTdhMzAgMzAgMCAwIDEgMCA2MGgtMTciIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzRiNjM4YyIgc3Ryb2tlLXdpZHRoPSI4Ii8+PHRleHQgeD0iMTYwIiB5PSIyNzQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM0YjYzOGMiIGZvbnQtc2l6ZT0iMTMiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIj7sl7Dqtazsmqkg7JiI7IucIOydtOuvuOyngDwvdGV4dD48L3N2Zz4=','머그컵',0,32000,'simulated_krw_price',null,true),
  ('study-fixed:notebook','study-simulated-fixed-v1',array['R1','R2','R3','R4']::text[],'하루 기록 노트와 펜 세트','하루 기록 노트와 펜 세트','연구용 가상 상품입니다. 상품 정보: 일상을 기록하는 노트 2권과 펜 1개로 구성된 세트입니다. 연구용 예시 후기(실제 구매 후기 아님): 종이가 부드럽고 매일 짧게 쓰기 편했다는 예시 의견입니다.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzIwIDMwMCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIzMDAiIHJ4PSIyNCIgZmlsbD0iI2VlZjRmZiIvPjxyZWN0IHg9IjEwMCIgeT0iNjUiIHdpZHRoPSIxMjAiIGhlaWdodD0iMTcwIiByeD0iOSIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjNGI2MzhjIiBzdHJva2Utd2lkdGg9IjgiLz48cGF0aCBkPSJNMTI3IDkzaDY2TTEyNyAxMTVoNjZNMTI3IDEzN2g0NSIgc3Ryb2tlPSIjODNhM2Q2IiBzdHJva2Utd2lkdGg9IjciLz48dGV4dCB4PSIxNjAiIHk9IjI3NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzRiNjM4YyIgZm9udC1zaXplPSIxMyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiPuyXsOq1rOyaqSDsmIjsi5wg7J2066+47KeAPC90ZXh0Pjwvc3ZnPg==','문구',0,28000,'simulated_krw_price',null,true),
  ('study-fixed:blanket','study-simulated-fixed-v1',array['R1','R2','R3','R4']::text[],'포근한 무릎담요','포근한 무릎담요','연구용 가상 상품입니다. 상품 정보: 실내에서 무릎 위에 덮어 사용할 수 있는 단색 담요입니다. 연구용 예시 후기(실제 구매 후기 아님): 휴식할 때 가볍게 덮기 좋았다는 예시 의견입니다.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzIwIDMwMCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIzMDAiIHJ4PSIyNCIgZmlsbD0iI2VlZjRmZiIvPjxyZWN0IHg9Ijk1IiB5PSIxMTAiIHdpZHRoPSIxMzAiIGhlaWdodD0iMTE1IiByeD0iMTIiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzRiNjM4YyIgc3Ryb2tlLXdpZHRoPSI4Ii8+PHBhdGggZD0iTTgyIDExMGgxNTZNMTYwIDExMHYxMTUiIHN0cm9rZT0iIzgzYTNkNiIgc3Ryb2tlLXdpZHRoPSIxMyIvPjxwYXRoIGQ9Ik0xMzAgMTA2cS0zMC0zOCAwLTQyIDIyLTIgMzAgNDJtMCAwcTgtNDQgMzAtNDIgMzAgNCAwIDQyIiBmaWxsPSJub25lIiBzdHJva2U9IiM0YjYzOGMiIHN0cm9rZS13aWR0aD0iNyIvPjx0ZXh0IHg9IjE2MCIgeT0iMjc0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNGI2MzhjIiBmb250LXNpemU9IjEzIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+7Jew6rWs7JqpIOyYiOyLnCDsnbTrr7jsp4A8L3RleHQ+PC9zdmc+','생활 소품',0,42000,'simulated_krw_price',null,true)
on conflict (source_product_id) do nothing;

with candidate_rows as (
  select p.*,array_position(array['study-fixed:cup','study-fixed:notebook','study-fixed:blanket'],p.source_product_id) as display_order
  from public.study_products p
  where p.source_product_id=any(array['study-fixed:cup','study-fixed:notebook','study-fixed:blanket'])
    and p.dataset_version='study-simulated-fixed-v1' and p.reviewed
), fixed as (
  select jsonb_agg(jsonb_build_object(
    'source_product_id',source_product_id,'name_ko',name_ko,'name_original',name_original,
    'description_original',description_original,'image_url',image_url,'category',category,
    'price_krw',price_krw,'price_original_usd',price_original_usd,'source_url',source_url,
    'dataset_version',dataset_version,'reason','연구용 가상 상품입니다. 상품 정보와 예시 후기를 확인해 주세요.') order by display_order) as candidates
  from candidate_rows
), scenes as (
  select profile_code,condition,fixed.candidates,
    jsonb_build_array(jsonb_build_object('phase','candidates','speaker','agent','kind','text',
      'content','친구 A가 당신의 생일 선물을 준비했습니다. 다음 내용은 연구자가 구성한 가상 시나리오입니다.','offset_ms',0)) ||
    case when condition in ('A','C') then
      jsonb_build_array(
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content','친구 A가 첫 번째 선물 방향을 직접 요청했습니다.','offset_ms',1000),
        jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content','첫 번째 연구용 후보입니다.','offset_ms',4000,'payload',jsonb_build_object('product',fixed.candidates->0)),
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content','첫 번째 후보를 담았습니다.','offset_ms',7000,'payload',jsonb_build_object('product',fixed.candidates->0)),
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content','친구 A가 두 번째 선물 방향을 직접 요청했습니다.','offset_ms',9000),
        jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content','두 번째 연구용 후보입니다.','offset_ms',12000,'payload',jsonb_build_object('product',fixed.candidates->1)),
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content','두 번째 후보를 담았습니다.','offset_ms',15000,'payload',jsonb_build_object('product',fixed.candidates->1)),
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content','친구 A가 세 번째 선물 방향을 직접 요청했습니다.','offset_ms',17000),
        jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content','세 번째 연구용 후보입니다.','offset_ms',20000,'payload',jsonb_build_object('product',fixed.candidates->2)),
        jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content','세 번째 후보를 담았습니다.','offset_ms',23000,'payload',jsonb_build_object('product',fixed.candidates->2))
      )
    else jsonb_build_array(jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_batch',
      'content','친구 A를 위한 연구용 선물 후보 세 개를 한 번에 보여드립니다.','offset_ms',4000,
      'payload',jsonb_build_object('candidates',fixed.candidates))) end ||
    jsonb_build_array(
      jsonb_build_object('phase','decision','speaker',case when condition in ('A','B') then 'giver' else 'agent' end,
        'kind','text','content','세 후보의 상품 정보를 비교했습니다.','offset_ms',0),
      jsonb_build_object('phase','decision','speaker',case when condition in ('A','B') then 'giver' else 'agent' end,
        'kind','final_selection','content','이 상황에서는 머그 세트를 최종 선물로 정했습니다. 일상에서 두 사람이 사용할 수 있다는 점을 이유로 들었습니다.','offset_ms',5000,
        'payload',jsonb_build_object('source_product_id','study-fixed:cup'))
    ) as transcript
  from fixed cross join (values ('R1'),('R2'),('R3'),('R4')) as profiles(profile_code)
  cross join (values ('A'),('B'),('C'),('D')) as conditions(condition)
  where jsonb_array_length(fixed.candidates)=3
)
insert into public.study_stimuli(profile_code,condition,stimulus_version,origin,transcript,
  candidate_snapshots,final_product_id,approved_at,approved_by)
select profile_code,condition,'birthday-friend-a-web-v2','scripted',transcript,candidates,
  'study-fixed:cup',clock_timestamp(),'researcher_seeded_simulation' from scenes
on conflict (profile_code,condition,stimulus_version) do update set
  transcript=excluded.transcript,candidate_snapshots=excluded.candidate_snapshots,
  final_product_id=excluded.final_product_id,approved_at=excluded.approved_at,
  approved_by=excluded.approved_by
where public.study_stimuli.approved_at is null
  and not exists(select 1 from public.study_trials t where t.stimulus_id=public.study_stimuli.id);
do $$
begin
  if (select count(*) from public.study_stimuli
      where stimulus_version='birthday-friend-a-web-v2' and approved_at is not null)<>16 then
    raise exception 'P02_STIMULI_NOT_COMPLETE';
  end if;
end $$;
commit;

select count(*) as approved_p02_scenes from public.study_stimuli
where stimulus_version='birthday-friend-a-web-v2' and approved_at is not null;
