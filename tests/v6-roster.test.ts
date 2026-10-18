import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENT } from "../config/experiment";
import { profileAt, v6RosterSlot } from "../lib/experiment/assignment";

describe("30-person v6 roster balance", () => {
  it("balances condition × profile cells across each role from 7 to 8 assignments", () => {
    const sequenceIds=Object.keys(EXPERIMENT.sequences);
    const counts=[new Map<string,number>(),new Map<string,number>()];
    for(let subjectIndex=0;subjectIndex<30;subjectIndex++){
      const {sequenceId,profileRotationOffset,enrollmentBlock}=v6RosterSlot(subjectIndex,sequenceIds);
      assert.equal(enrollmentBlock,Math.floor(subjectIndex/5)+1);
      for(const [roleIndex,roleOffset] of [profileRotationOffset,(profileRotationOffset+1)%4].entries()){
        const sequence=EXPERIMENT.sequences[sequenceId as keyof typeof EXPERIMENT.sequences];
        sequence.forEach((condition,position)=>{
          const profile=profileAt(position+1,roleOffset,EXPERIMENT.profileVersion);
          const key=`${condition}:${profile}`;
          counts[roleIndex].set(key,(counts[roleIndex].get(key)??0)+1);
        });
      }
    }
    for(const roleCounts of counts){
      assert.equal(roleCounts.size,16);
      assert.equal(Math.min(...roleCounts.values()),7);
      assert.equal(Math.max(...roleCounts.values()),8);
    }
  });

  it("enrolls exactly five at a time with a 3:2 role-order split per block", () => {
    for(let block=0;block<6;block++){
      let giverFirst=0;
      for(let within=0;within<5;within++){
        const number=block*5+within+1;
        const giverSlots=new Set([0,1,4]);
        if(giverSlots.has((within+block)%5))giverFirst++;
      }
      assert.equal(giverFirst,3);
    }
  });
});
