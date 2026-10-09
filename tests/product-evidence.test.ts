import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComparison } from "../lib/experiment/transcript";
import { buildProductRecommendation } from "../lib/catalog/productEvidence";

const candidates = [
  { display_order: 1, product_snapshot: { source_product_id: "10308385", product_name: "올드베이 클래식 시즈닝", price: 6000 } },
  { display_order: 2, product_snapshot: { source_product_id: "36995775", product_name: "대시 오리지널 무염 시즈닝", price: 17700 } },
  { display_order: 3, product_snapshot: { source_product_id: "864008591", product_name: "네이비 블루 테이블 러너", price: 20200 } },
];

const context = {
  profile: { name: "도윤", hobbies: ["요리", "식탁 꾸미기"] },
  priorities: ["실용성", "감성적"],
  budget: 50000,
};

describe("source-based product explanations", () => {
  it("keeps three distinct product facts and considerations in the same comparison", () => {
    const rows = buildComparison(candidates, context);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.budget_fit), [
      "고정 예산 50,000원 이내 · 44,000원 남음",
      "고정 예산 50,000원 이내 · 32,300원 남음",
      "고정 예산 50,000원 이내 · 29,800원 남음",
    ]);
    assert.equal(new Set(rows.map(row => row.core_features)).size, 3);
    assert.equal(new Set(rows.map(row => row.consideration)).size, 3);
    assert.match(rows[0].core_features, /6온스/);
    assert.match(rows[1].core_features, /21온스/);
    assert.match(rows[2].core_features, /14×72/);
    assert.match(rows[2].emotional_meaning, /식탁 꾸미기/);
  });

  it("separates source facts from the recipient-fit interpretation", () => {
    const recommendation = buildProductRecommendation(candidates[0], candidates, context);
    assert.match(recommendation.productEvidence, /^원본 정보:/);
    assert.match(recommendation.recipientConnection, /^해석:/);
    assert.match(recommendation.comparativeStrength, /세 후보 중 연구용 가격이 가장 낮/);
  });
});
