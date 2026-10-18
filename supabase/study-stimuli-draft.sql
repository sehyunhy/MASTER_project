-- Optional researcher REVIEW DRAFT. Requires study-fresh.sql and study-products.sql.
-- Rows remain unapproved. The recipient role is blocked until the researcher
-- inspects the transcript and product snapshots and explicitly sets approved_at.
begin;
do $$
declare profile text; condition_code text; products jsonb; names text[]; ids text[];
  transcript_value jsonb; final_id text; final_name text;
begin
  foreach profile in array array['R1','R2','R3','R4'] loop
    select jsonb_agg(jsonb_build_object(
      'source_product_id',source_product_id,'name_ko',name_ko,'name_original',name_original,
      'description_original',description_original,'image_url',image_url,
      'category',category,'price_krw',price_krw,'price_original_usd',price_original_usd,
      'source_url',source_url,'dataset_version',dataset_version,'reason','종이 프로필과 기록된 상품 정보를 함께 확인해 주세요.'
    ) order by source_product_id),
    array_agg(name_ko order by source_product_id),
    array_agg(source_product_id order by source_product_id)
    into products,names,ids
    from public.study_products where reviewed and profile_codes @> array[profile] and price_krw<=50000;
    if jsonb_array_length(coalesce(products,'[]'::jsonb))<>3 then
      raise exception 'Exactly 3 reviewed products required for %',profile;
    end if;
    final_id:=ids[1];final_name:=names[1];
    foreach condition_code in array array['A','B','C','D'] loop
      if condition_code in ('A','C') then
        transcript_value:=jsonb_build_array(
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content',
            format('종이 프로필의 관심사에 맞고 평소 쓰기 편한 %s 종류의 첫 번째 후보를 한 개 찾아주세요.',products->0->>'category'),'offset_ms',3000),
          jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content',
            '첫 번째 후보를 기록된 상품에서 제시했습니다.','payload',jsonb_build_object('product',products->0),'offset_ms',10000),
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content',
            '첫 번째 상품을 후보로 확정합니다. 두 번째는 다른 종류에서 찾아주세요.','offset_ms',18000),
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content',
            format('같은 사람의 선호를 고려해 이번에는 %s 종류의 후보를 한 개 제안해 주세요.',products->1->>'category'),'offset_ms',22000),
          jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content',
            '두 번째 후보를 제시했습니다.','payload',jsonb_build_object('product',products->1),'offset_ms',26000),
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content',
            '두 번째 상품을 후보로 확정합니다. 세 번째도 확인하겠습니다.','offset_ms',34000),
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_request','content',
            format('마지막으로 %s 종류에서 한 개를 제안해 주세요.',products->2->>'category'),'offset_ms',38000),
          jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_proposal','content',
            '세 번째 후보를 제시했습니다.','payload',jsonb_build_object('product',products->2),'offset_ms',42000),
          jsonb_build_object('phase','candidates','speaker','giver','kind','candidate_confirmed','content',
            '세 번째 상품도 후보로 확정합니다.','offset_ms',48000)
        );
      else
        transcript_value:=jsonb_build_array(
          jsonb_build_object('phase','candidates','speaker','agent','kind','text','content',
            '종이 프로필과 승인된 상품 기록을 바탕으로 세 후보를 한 번에 준비했습니다.','offset_ms',0),
          jsonb_build_object('phase','candidates','speaker','agent','kind','candidate_batch','content',
            '세 상품을 함께 확인해 주세요.','payload',jsonb_build_object('candidates',products),'offset_ms',0)
        );
      end if;
      transcript_value:=transcript_value||jsonb_build_array(
        jsonb_build_object('phase','decision','speaker',case when condition_code in ('A','B') then 'giver' else 'agent' end,
          'kind','text','content','세 후보의 기록된 상품명, 가격, 종류를 비교했습니다.','offset_ms',0),
        jsonb_build_object('phase','decision','speaker',case when condition_code in ('A','B') then 'giver' else 'agent' end,
          'kind','final_selection','content',
          format('선택한 상품은 %s입니다. 종이 프로필과 상품 기록을 검토해 이 상품을 선택했습니다.',final_name),
          'payload',jsonb_build_object('source_product_id',final_id),'offset_ms',5000)
      );
      insert into public.study_stimuli(profile_code,condition,stimulus_version,transcript,
        candidate_snapshots,final_product_id,approved_at,approved_by)
      values(profile,condition_code,'study-v7-review-draft',transcript_value,products,final_id,null,null)
      on conflict(profile_code,condition,stimulus_version) do update
        set transcript=excluded.transcript,candidate_snapshots=excluded.candidate_snapshots,
          final_product_id=excluded.final_product_id,approved_at=null,approved_by=null;
    end loop;
  end loop;
end; $$;
commit;
