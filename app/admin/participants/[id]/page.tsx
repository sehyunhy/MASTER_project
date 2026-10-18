"use client";
import { useEffect, useState } from "react";
export default function ParticipantPage({params}:{params:Promise<{id:string}>}) {
  const [data,setData]=useState<any>(null);const [error,setError]=useState("");
  useEffect(()=>{params.then(async ({id})=>{
    const password=sessionStorage.getItem("adminPassword")??"";
    const response=await fetch("/api/admin/participants/"+id,{headers:{"x-admin-password":password}});
    const result=await response.json();
    if(!response.ok)setError(result.error);else setData(result);
  });},[params]);
  return <main className="shell"><section className="panel"><a href="/admin">← 관리자 현황</a>
    <h1 className="title">참가자 #{data?.person.enrollment_number??"…"}</h1>{error&&<p role="alert">{error}</p>}
    {data&&<><p>역할 순서: {data.person.role_order.join(" → ")} · 조건 순서: {data.person.condition_order.join(" → ")}</p>
      {data.trials.map((trial:any)=><article className="card" key={trial.id} style={{marginTop:12}}>
        <h2>{trial.role} · {trial.condition} · {trial.phase}</h2>
        <p>후보 {trial.candidate_snapshots.length}개 · 최종 {trial.final_product_id??"미정"} · 설문 {trial.survey_completed_at?"완료":"미완료"}</p>
        <p>후보 {trial.candidates_effective_ms??"—"}ms · 최종 {trial.decision_effective_ms??"—"}ms · 운영자 확인 {trial.operator_review_needed?"필요":"없음"}</p>
      </article>)}
      <h2>이벤트 로그</h2><ol>{data.events.map((event:any)=><li key={event.id}>
        {event.server_at} · {event.role}/{event.condition} · {event.actor}/{event.origin} · {event.event_type}
      </li>)}</ol></>}
  </section></main>;
}
