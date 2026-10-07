import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENT } from "../config/experiment";
import { conditionAt, profileAt, profileRotationOffsetForSlot, validateWilliamsSequences } from "../lib/experiment/assignment";
import { transition } from "../lib/experiment/stateMachine";

describe("experiment design invariants",()=>{
  it("validates all Williams positions and ordered carryover pairs",()=>{const result=validateWilliamsSequences();assert.equal(result.sequences.length,4);assert.equal(Object.keys(result.adjacentPairCounts).length,12);});
  it("assigns four unique conditions to every sequence",()=>{for(const id of Object.keys(EXPERIMENT.sequences) as (keyof typeof EXPERIMENT.sequences)[]){const list=[1,2,3,4].map(n=>conditionAt(id,n));assert.equal(new Set(list).size,4);}});
  it("rotates profiles independently from the condition sequence",()=>{for(let offset=0;offset<4;offset++)assert.deepEqual([1,2,3,4].map(n=>profileAt(n,offset)).sort(),["R1","R2","R3","R4"]);});
  it("balances every condition × profile cell at ten per 40-person role roster",()=>{
    const counts=new Map<string,number>();
    for(let participantNumber=1;participantNumber<=40;participantNumber++){
      const intimacy=participantNumber<=20?"high":"low";
      const groupIndex=participantNumber<=20?participantNumber-1:participantNumber-21;
      const sequence=("S"+(Math.floor(groupIndex/5)+1)) as keyof typeof EXPERIMENT.sequences;
      const offset=profileRotationOffsetForSlot(participantNumber,intimacy);
      for(let trialNumber=1;trialNumber<=4;trialNumber++){
        const key=conditionAt(sequence,trialNumber)+":"+profileAt(trialNumber,offset);
        counts.set(key,(counts.get(key)??0)+1);
      }
    }
    assert.equal(counts.size,16);
    assert.ok([...counts.values()].every(count=>count===10));
  });
  it("only allows the expected trial state transitions",()=>{assert.equal(transition("pending","active"),"active");assert.throws(()=>transition("completed","active"));});
});
