import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relationshipForParticipant } from "../lib/experiment/relationship";

describe("assigned relationship context", () => {
  it("does not invent a relationship type or history from high/low alone", () => {
    const high = relationshipForParticipant("high", "giver");
    const low = relationshipForParticipant("low", "recipient");
    assert.equal(high.conditionLabel, "친밀도 높음");
    assert.equal(low.conditionLabel, "친밀도 낮음");
    assert.equal(high.relationshipType, null);
    assert.equal(low.situation, null);
  });

  it("uses only complete researcher wording for the assigned condition and role", () => {
    const approved = {
      high: { relationship_type: "승인된 관계 유형 A", situation: "승인된 상황 A" },
      low: { relationship_type: "승인된 관계 유형 B", situation: "승인된 상황 B" },
    };
    const giver = relationshipForParticipant("high", "giver", approved);
    const recipient = relationshipForParticipant("low", "recipient", approved);
    assert.equal(giver.relationshipType, "승인된 관계 유형 A");
    assert.equal(giver.situation, "승인된 상황 A");
    assert.equal(recipient.relationshipType, "승인된 관계 유형 B");
    assert.equal(recipient.heading, "당신과 선물 주는 사람의 관계");
    assert.equal(relationshipForParticipant("low", "giver", { low: { relationship_type: "일부", situation: "" } }).relationshipType, null);
  });
});
