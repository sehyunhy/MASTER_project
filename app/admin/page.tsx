"use client";
import { useState } from "react";
const exports=["study_people","study_trials","study_messages","study_events","study_metrics","study_products","study_stimuli"];
export default function AdminPage() {
  const [password,setPassword]=useState("");
  const [summary,setSummary]=useState<any>(null);
  const [error,setError]=useState("");
  async function load() {
    const response=await fetch("/api/admin/summary",{headers:{"x-admin-password":password}});
    const result=await response.json();
    if(!response.ok){setError(result.error);return;}
    sessionStorage.setItem("adminPassword",password);setSummary(result);setError("");
  }
  async function download(name:string) {
    const response=await fetch("/api/admin/export?name="+name,{headers:{"x-admin-password":password}});
    if(!response.ok){setError("CSV 내보내기에 실패했습니다.");return;}
    const url=URL.createObjectURL(await response.blob());
    const link=document.createElement("a");link.href=url;link.download=name+".csv";link.click();
    URL.revokeObjectURL(url);
  }
  return <main className="shell"><section className="panel"><p className="eyebrow">연구자 전용</p><h1 className="title">연구 진행 현황</h1>
    <label>관리자 비밀번호<input className="field" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <button className="button" onClick={load}>현황 보기</button>{error&&<p role="alert">{error}</p>}
    {summary&&<><div className="grid" style={{marginTop:22}}>{[
      ["등록된 사람",summary.count],["진행 중",summary.active],["완료",summary.completed],
      ["운영자 확인 필요",summary.reviewNeeded],["완료된 역할별 조건",summary.trialsCompleted],
      ["시간초과 후 미완료",summary.trialsSkipped],
    ].map(([label,value])=><div className="card" key={label}><p className="eyebrow">{label}</p><h2>{value}</h2></div>)}</div>
      <h2>조건 순서 배정</h2><pre>{JSON.stringify(summary.orderCounts,null,2)}</pre>
      <h2>참가자</h2><div className="grid">{summary.people.map((person:any)=>
        <a className="card" href={"/admin/participants/"+person.id} key={person.id}>
          <b>#{person.enrollment_number}</b><p>{person.status} · {person.active_role} · {person.condition_order.join(" → ")}</p>
        </a>)}</div>
      <h2>원시 데이터·계산 지표</h2><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {exports.map(name=><button className="button secondary" key={name} onClick={()=>download(name)}>{name}.csv</button>)}
      </div></>}
  </section></main>;
}
