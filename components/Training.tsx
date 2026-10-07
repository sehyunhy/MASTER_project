"use client";
import { useEffect, useState } from "react";

const scenarios = [
  { intro: "AI가 받는 사람에게 어울리는 선물 후보를 만들기 전에 참가자에게 선물 기준을 묻고, 참가자의 답을 참고해 후보를 만들었습니다.", prompt: "선물 후보를 만드는 과정에서 참가자가 추가 판단을 제공했습니까?", options: [["yes","예"],["no","아니오"]] },
  { intro: "AI가 받는 사람의 프로필과 선물 조건을 스스로 살펴보고, 참가자에게 추가 질문을 하지 않은 채 선물 후보를 만들었습니다.", prompt: "선물 후보를 만드는 과정에서 참가자가 추가 판단을 제공했습니까?", options: [["yes","예"],["no","아니오"]] },
  { intro: "참가자가 선물 후보를 비교한 뒤 최종 선물을 직접 골랐습니다.", prompt: "최종 선물 선택을 결정한 주체는 누구입니까?", options: [["user","참가자"],["ai","AI"]] },
  { intro: "AI가 선물 후보를 비교한 뒤 최종 선물을 결정했습니다.", prompt: "최종 선물 선택을 결정한 주체는 누구입니까?", options: [["user","참가자"],["ai","AI"]] },
];
export function Training() {
  const [answers, setAnswers] = useState<string[]>(["","","",""]);
  const [result, setResult] = useState<{passed:boolean;score:number;attempt:number}|null>(null);
  const [error, setError] = useState(""); const [busy,setBusy]=useState(false);
  const participantId = typeof window !== "undefined" ? sessionStorage.getItem("participantId") : null;
  async function submit() {
    if (!participantId) { window.location.assign("/start"); return; }
    setBusy(true); setError("");
    try { const r=await fetch("/api/training",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,answers})}); const d=await r.json(); if(!r.ok) throw new Error(d.error); setResult(d); }
    catch(e){setError(e instanceof Error?e.message:"응답을 저장하지 못했습니다.");} finally{setBusy(false);}
  }
  useEffect(() => { if (participantId) fetch("/api/experiment/action", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"event",participantId,eventType:"training_started"}) }).catch(()=>{}); }, [participantId]);
  const retry=()=>{setResult(null);setAnswers(["","","",""]);};
  return <section className="panel" style={{maxWidth:760,margin:"30px auto"}}><p className="eyebrow">시작 전 안내</p><h1 className="title">추천 과정 알아보기</h1><p className="body">선물 후보를 만드는 과정은 두 가지 방식으로 진행될 수 있습니다. 한 방식에서는 AI가 참가자에게 선물 기준을 질문하고 답을 참고합니다. 다른 방식에서는 AI가 받는 사람의 프로필과 선물 조건을 살펴 별도 답변 없이 후보를 만듭니다. 마지막 선물 선택은 참가자 또는 AI가 맡을 수 있습니다. 아래 상황을 읽고 해당하는 답을 선택해 주세요.</p>
  {!result ? <><div style={{display:"grid",gap:18,marginTop:24}}>{scenarios.map((s,i)=><div className="card" key={i}><p><b>연습 {i+1} / 4</b></p><p className="body">{s.intro}</p><p>{s.prompt}</p><div style={{display:"flex",gap:18}}>{s.options.map(([v,label])=><label key={v}><input type="radio" name={`q${i}`} checked={answers[i]===v} onChange={()=>setAnswers(a=>a.map((x,j)=>i===j?v:x))}/> {label}</label>)}</div></div>)}</div>{error&&<p role="alert">{error}</p>}<button className="button" style={{marginTop:22}} disabled={answers.some(x=>!x)||busy} onClick={submit}>{busy?"확인 중…":"답변 제출"}</button></> : result.passed ? <div style={{marginTop:24}}><p>모든 문항에 올바르게 답했습니다. 이제 연구를 시작할 수 있습니다.</p><a className="button" href={sessionStorage.getItem("role")==="recipient"?"/experiment/recipient":"/experiment/giver"}>계속</a></div> : <div style={{marginTop:24}}><p>정답 {result.score} / 4입니다. 안내를 다시 읽고 연습을 진행해 주세요.</p><p className="body">AI는 참가자의 답을 참고해 선물 후보를 만들거나, 받는 사람의 정보만 살펴 후보를 만들 수 있습니다. 최종 선물 선택은 참가자 또는 AI가 맡을 수 있습니다.</p><button className="button" onClick={retry}>다시 연습하기</button></div>}</section>;
}
