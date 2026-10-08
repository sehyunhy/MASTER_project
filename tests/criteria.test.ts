import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { criteriaInText, isOnlyCriteria, mergeCriteria, normalizeCriteria, participantCriterionText, toggleCriterion } from "../lib/experiment/criteria";
import { recommendCatalogItems } from "../lib/catalog/recommend";

describe("recommendation criteria", () => {
  it("shows old saved wording as 감성적 without losing other choices", () => {
    assert.deepEqual(normalizeCriteria(["실용성", "개인적 의미", "취향 적합성", "감성적"]), ["실용성", "감성적", "취향 적합성"]);
    assert.equal(participantCriterionText("개인적 의미를 반영했습니다."), "감성적 기준을 반영했습니다.");
  });
  it("extracts comma separated criteria while leaving free text available", () => {
    assert.deepEqual(criteriaInText("실용성, 취향 적합성"), ["실용성", "취향 적합성"]);
    assert.equal(isOnlyCriteria("실용성, 취향 적합성"), true);
    assert.equal(isOnlyCriteria("실용성으로 후보를 찾아주세요"), false);
  });
  it("combines menu and text criteria, then toggles each choice independently", () => {
    assert.deepEqual(mergeCriteria(["감성적"],"실용성, 취향 적합성"),["감성적","실용성","취향 적합성"]);
    assert.deepEqual(toggleCriterion(["실용성","감성적"],"실용성"),["감성적"]);
    assert.deepEqual(toggleCriterion(["감성적"],"실용성"),["감성적","실용성"]);
  });
});

describe("Walmart candidate fields", () => {
  it("uses the experiment price and search tags rather than retired fields", () => {
    const items=[1,2,3,4].map(n=>({id:String(n),sku:String(n),source_product_id:String(n),category:"스킨케어",price_experiment:n===4?60000:10000,profile_codes:["R1v2"],search_tags_ko:["daily"],is_active:true}));
    const selected=recommendCatalogItems(items as any,"R1v2",{priorities:["실용성"]},50000);
    assert.deepEqual(selected.map(item=>item.source_product_id),["1","2","3"]);
  });
});
