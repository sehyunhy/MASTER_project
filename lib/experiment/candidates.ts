import { EXPERIMENT } from "@/config/experiment";

export function selectControlledCandidates<T extends { product_name:string }>(pool:T[],guidedAnswers?:string[]){
  if(pool.length<3)throw new Error("Controlled candidate pool must contain at least three items.");
  let start=0;
  if(guidedAnswers?.length){
    const answerPositions=guidedAnswers.map((answer,i)=>Math.max(0,EXPERIMENT.questions[i]?.options.indexOf(answer)??0));
    start=answerPositions.reduce((sum,n)=>sum+n,0)%pool.length;
  }
  const indexes=[start,(start+4)%pool.length,(start+8)%pool.length];
  return indexes.map(i=>pool[i]);
}
