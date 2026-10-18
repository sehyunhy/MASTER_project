import assert from "node:assert/strict";
import test from "node:test";
import profiles from "../config/study-profiles.json";
import { preflightHumanRequest, verifiedEvidence, groundedReason } from "../lib/study/agent";
import { orderForEnrollment, STUDY_RIGHTS } from "../lib/study/sequence";

const profile=profiles.profiles[0];
test("A/C require a concrete participant request before an Agent call",()=>{
  assert.match(preflightHumanRequest("선물 추천해줘",profile)??"",/관심사|구체적인/);
  assert.match(preflightHumanRequest("그냥 네가 알아서 골라줘",profile)??"",/관심사|구체적인/);
  assert.equal(preflightHumanRequest("피부 관리를 즐기는 지안에게 간단히 사용할 수 있는 보습 제품을 찾아주세요.",profile),null);
});
test("current condition rights and five-person ordering have no thirty-person limit",()=>{
  assert.deepEqual(STUDY_RIGHTS.A,{builder:"human",decider:"human",candidateMode:"sequential"});
  assert.deepEqual(STUDY_RIGHTS.B,{builder:"agent",decider:"human",candidateMode:"batch"});
  assert.deepEqual(STUDY_RIGHTS.C,{builder:"human",decider:"agent",candidateMode:"sequential"});
  assert.deepEqual(STUDY_RIGHTS.D,{builder:"agent",decider:"agent",candidateMode:"batch"});
  for(const count of [30,50,101]) {
    const assignments=Array.from({length:count},(_,index)=>orderForEnrollment(index+1));
    assert.equal(assignments.at(-1)?.block,Math.ceil(count/5));
    for(let start=0;start+5<=count;start+=5)
      assert.equal(new Set(assignments.slice(start,start+5).map(slot=>slot.orderIndex)).size,4);
  }
});
test("Agent product evidence must come from the saved source description",()=>{
  const product={source_product_id:"x",name_ko:"기록된 상품",name_original:"Original recorded gift",
    description_original:"The recorded gift is a blue cotton item for daily use.",
    category:"Daily goods",price_krw:20000};
  assert.equal(verifiedEvidence(product,"blue cotton item"),"blue cotton item");
  assert.throws(()=>verifiedEvidence(product,"invented medical benefit"));
  const reason=groundedReason(profile,product,"blue cotton item");
  assert.match(reason,/20,000원/);
  assert.doesNotMatch(reason,/medical/);
});
