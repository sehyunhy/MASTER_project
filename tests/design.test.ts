import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENT } from "../config/experiment";
import { conditionAt, profileAt, validateWilliamsSequences } from "../lib/experiment/assignment";
import { transition } from "../lib/experiment/stateMachine";
import { selectControlledCandidates } from "../lib/experiment/candidates";

describe("experiment design invariants",()=>{
  it("validates all Williams positions and ordered carryover pairs",()=>{const result=validateWilliamsSequences();assert.equal(result.sequences.length,4);assert.equal(Object.keys(result.adjacentPairCounts).length,12);});
  it("assigns four unique conditions to every sequence",()=>{for(const id of Object.keys(EXPERIMENT.sequences) as (keyof typeof EXPERIMENT.sequences)[]){const list=[1,2,3,4].map(n=>conditionAt(id,n));assert.equal(new Set(list).size,4);}});
  it("rotates profiles independently from the condition sequence",()=>{for(let offset=0;offset<4;offset++)assert.deepEqual([1,2,3,4].map(n=>profileAt(n,offset)).sort(),["R1","R2","R3","R4"]);});
  it("only allows the expected trial state transitions",()=>{assert.equal(transition("pending","active"),"active");assert.throws(()=>transition("completed","active"));});
  it("returns exactly three deterministic candidates from a controlled pool",()=>{const pool=Array.from({length:10},(_,i)=>({product_name:`gift-${i}`}));assert.equal(selectControlledCandidates(pool).length,3);assert.deepEqual(selectControlledCandidates(pool,["취향 적합성","일상생활","편리함"]),selectControlledCandidates(pool,["취향 적합성","일상생활","편리함"]));});
});
