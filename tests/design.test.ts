import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENT } from "../config/experiment";
import { conditionAt, profileAt, v6RosterSlot, validateWilliamsSequences } from "../lib/experiment/assignment";
import { transition } from "../lib/experiment/stateMachine";

describe("experiment design invariants",()=>{
  it("validates all Williams positions and ordered carryover pairs",()=>{const result=validateWilliamsSequences();assert.equal(result.sequences.length,4);assert.equal(Object.keys(result.adjacentPairCounts).length,12);});
  it("assigns four unique conditions to every sequence",()=>{for(const id of Object.keys(EXPERIMENT.sequences) as (keyof typeof EXPERIMENT.sequences)[]){const list=[1,2,3,4].map(n=>conditionAt(id,n));assert.equal(new Set(list).size,4);}});
  it("rotates profiles independently from the condition sequence",()=>{for(let offset=0;offset<4;offset++)assert.deepEqual([1,2,3,4].map(n=>profileAt(n,offset)).sort(),["R1","R2","R3","R4"]);});
  it("balances every condition × profile cell across the v6 30-person roster without intimacy blocks",()=>{
    const counts=new Map<string,number>();
    for(let participantNumber=0;participantNumber<30;participantNumber++){
      const {sequenceId,profileRotationOffset}=v6RosterSlot(participantNumber);
      for(let trialNumber=1;trialNumber<=4;trialNumber++){
        const key=conditionAt(sequenceId as keyof typeof EXPERIMENT.sequences,trialNumber)+":"+profileAt(trialNumber,profileRotationOffset,EXPERIMENT.profileVersion);
        counts.set(key,(counts.get(key)??0)+1);
      }
    }
    assert.equal(counts.size,16);
    assert.ok([...counts.values()].every(count=>count===7||count===8));
  });
  it("only allows the expected trial state transitions",()=>{assert.equal(transition("pending","active"),"active");assert.throws(()=>transition("completed","active"));});
});
