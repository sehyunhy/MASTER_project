import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, MINIMUM_EXPOSURE_MS, EXPERIMENT } from "../config/experiment";
import { assignedRelationshipType, relationshipForParticipant, relationshipScenarioId, relationshipV3 } from "../lib/experiment/relationship";
import { profileAt } from "../lib/experiment/assignment";
import historicalStimuli from "../config/gift-stimuli-v3.final.json";

describe("researcher approved v3 stimulus", () => {
  it("keeps the four exact people and removes occupation from runtime profiles", () => {
    assert.deepEqual(PROFILES.map(p=>[p.id,p.name,p.age,p.gender]),[
      ["R1v5","지안",29,"여성"],["R2v5","윤재",31,"남성"],
      ["R3v5","수빈",27,"여성"],["R4v5","현우",30,"남성"],
    ]);
    for(const p of PROFILES) {
      assert.equal(p.gift_budget,50_000);
      assert.equal(p.gift_occasion,"생일");
      assert.ok(p.participant_text.startsWith(`${p.name}`));
      assert.equal(Object.hasOwn(p,"occupation"),false);
    }
  });

  it("keeps historical relationship stimuli available but excludes intimacy from v6 assignment", () => {
    const historicalVersion="profiles-v3-relationship-types";
    assert.equal(EXPERIMENT.profileVersion,"profiles-v3-neutral-v6");
    assert.equal(assignedRelationshipType("high"),"romantic_partner");
    assert.equal(assignedRelationshipType("low"),"distant_college_peer");
    assert.equal(profileAt(1,0,historicalVersion),"R1v3");
    assert.equal(profileAt(1,0,EXPERIMENT.profileVersion),"R1v5");
    assert.deepEqual(historicalStimuli.profiles.map(p=>p.id),["R1v3","R2v3","R3v3","R4v3"]);
    assert.ok("relationship_stimuli" in historicalStimuli);
    const scenarios=PROFILES.flatMap(p=>["high","low"].map(c=>relationshipScenarioId(p.id,c)));
    assert.equal(new Set(scenarios).size,8);
    assert.equal(EXPERIMENT.sequences.V6S1.length,4);
  });

  it("shows the exact role wording and grammatical name particle", () => {
    const giver=relationshipV3("high","giver","수빈");
    const recipient=relationshipV3("low","recipient","수빈");
    assert.equal(giver.conditionLabel,"연인");
    assert.ok(giver.situation.startsWith("수빈은 당신과 교제 중인 연인입니다."));
    assert.equal(recipient.conditionLabel,"교류가 적은 대학 동기");
    assert.ok(recipient.situation.startsWith("선물을 주는 사람은 당신과 같은 대학에 같은 해 입학한 동기입니다."));
    assert.equal(relationshipV3("low","giver","윤재").situation.startsWith("윤재는"),true);
  });

  it("uses the relationship type pinned to the new trial", () => {
    const pinned=relationshipForParticipant("high","giver",undefined,{version:"profiles-v3-relationship-types",name:"지안",relationshipType:"distant_college_peer"});
    assert.equal(pinned.relationshipType,"distant_college_peer");
    assert.equal(pinned.conditionLabel,"교류가 적은 대학 동기");
  });

  it("retains fifteen seconds in practice and uses sixty seconds per v6 experiment phase", () => {
    assert.deepEqual(MINIMUM_EXPOSURE_MS.practice,{giver:15_000,recipient:15_000});
    assert.deepEqual(MINIMUM_EXPOSURE_MS.experiment,{giver:60_000,recipient:60_000});
  });
});
