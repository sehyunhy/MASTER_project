"use client";
import { useEffect, useState } from "react";

const scenarios = [
  { intro: "식당을 추천하기 전에 AI가 사용자에게 몇 가지 취향 질문을 하고, 답을 참고해 후보를 만들었습니다.", prompt: "후보를 만드는 과정에서 사용자가 직접 추가 판단을 제공했습니까?", options: [["yes","예"],["no","아니오"]] },
  { intro: "AI가 주어진 조건을 스스로 살펴 추가 입력을 받지 않고 주말 활동 후보를 만들었습니다.", prompt: "후보를 만드는 과정에서 사용자가 직접 추가 판단을 제공했습니까?", options: [["yes","예"],["no","아니오"]] },
  { intro: "식당 후보를 살펴본 뒤 사용자가 최종으로 갈 곳을 골랐습니다.", prompt: "최종 선택을 결정한 주체는 누구입니까?", options: [["user","사용자"],["ai","AI"]] },
  { intro: "주말 활동 후보를 비교한 뒤 AI가 최종 활동을 결정했습니다.", prompt: "최종 선택을 결정한 주체는 누구입니까?", options: [["user","사용자"],["ai","AI"]] },
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
  return <section className="panel" style={{maxWidth:760,margin:"30px auto"}}><p className="eyebrow">시작 전 안내</p><h1 className="title">추천 과정 알아보기</h1><p className="body">추천 후보를 만드는 과정은 두 가지 방식으로 진행될 수 있습니다. 한 방식에서는 AI가 몇 가지 질문을 하고 답을 참고합니다. 다른 방식에서는 AI가 제공된 정보를 스스로 살펴봅니다. 마지막 후보 선택은 사용자 또는 AI가 맡을 수 있습니다. 아래 상황을 읽고 해당하는 답을 선택해 주세요.</p>
  {!result ? <><div style={{display:"grid",gap:18,marginTop:24}}>{scenarios.map((s,i)=><div className="card" key={i}><p><b>연습 {i+1} / 4</b></p><p className="body">{s.intro}</p><p>{s.prompt}</p><div style={{display:"flex",gap:18}}>{s.options.map(([v,label])=><label key={v}><input type="radio" name={`q${i}`} checked={answers[i]===v} onChange={()=>setAnswers(a=>a.map((x,j)=>i===j?v:x))}/> {label}</label>)}</div></div>)}</div>{error&&<p role="alert">{error}</p>}<button className="button" style={{marginTop:22}} disabled={answers.some(x=>!x)||busy} onClick={submit}>{busy?"확인 중…":"답변 제출"}</button></> : result.passed ? <div style={{marginTop:24}}><p>모든 문항에 올바르게 답했습니다. 이제 연구를 시작할 수 있습니다.</p><a className="button" href={sessionStorage.getItem("role")==="recipient"?"/experiment/recipient":"/experiment/giver"}>계속</a></div> : <div style={{marginTop:24}}><p>정답 {result.score} / 4입니다. 안내를 다시 읽고 연습을 진행해 주세요.</p><p className="body">질문을 먼저 받고 답을 참고해 후보를 만들 수 있고, 제공된 정보만으로 후보를 만들 수도 있습니다. 최종 선택은 사용자 또는 AI가 맡을 수 있습니다.</p><button className="button" onClick={retry}>다시 연습하기</button></div>}</section>;
}
