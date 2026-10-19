"use client";
import { useState } from "react";
const exports=["study_people","study_trials","study_messages","study_events","study_metrics","study_products","study_stimuli","study_survey_responses"];
type PreparedProduct={source_product_id:string;name_ko:string;name_original:string;price_krw:number;image_url:string;source_url:string|null;description_original:string};
type StimulusPreview={version:string;count:number;approved:boolean;candidates:PreparedProduct[];finalProductId:string|null};
export default function AdminPage() {
  const [password,setPassword]=useState("");
  const [summary,setSummary]=useState<any>(null);
  const [stimulus,setStimulus]=useState<StimulusPreview|null>(null);
  const [stimulusBusy,setStimulusBusy]=useState(false);
  const [error,setError]=useState("");
  const [surveyNumber,setSurveyNumber]=useState("");
  const [surveyRole,setSurveyRole]=useState<"giver"|"recipient">("giver");
  const [surveyCondition,setSurveyCondition]=useState<"A"|"B"|"C"|"D">("A");
  const [surveySection,setSurveySection]=useState("posttrial");
  const [surveyVersion,setSurveyVersion]=useState("study2-study3-pilot-final");
  const [surveyPaperId,setSurveyPaperId]=useState("");
  const [surveyEnteredBy,setSurveyEnteredBy]=useState("");
  const [surveyAnswers,setSurveyAnswers]=useState("{}");
  const [surveySaved,setSurveySaved]=useState("");
  async function saveSurvey() {
    setSurveySaved("");setError("");
    try {
      const answers=JSON.parse(surveyAnswers);
      if(!answers||Array.isArray(answers)||typeof answers!=="object"||!Object.keys(answers).length)
        throw new Error("문항별 응답을 하나 이상 JSON 객체로 입력해 주세요.");
      const response=await fetch("/api/admin/survey",{method:"POST",headers:{"content-type":"application/json","x-admin-password":password},
        body:JSON.stringify({participantNumber:surveyNumber.trim().toUpperCase(),role:surveyRole,
          condition:surveySection==="posttrial"?surveyCondition:undefined,formSection:surveySection,
          formVersion:surveyVersion,paperFormId:surveyPaperId||undefined,
          enteredBy:surveyEnteredBy,answers})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??"설문 입력에 실패했습니다.");
      setSurveySaved(`저장됨 · ${surveyNumber.toUpperCase()} · ${surveyRole} · ${surveySection}${surveySection==="posttrial"?` · ${surveyCondition}`:""}`);
    } catch(cause) {setError(cause instanceof Error?cause.message:"설문 입력에 실패했습니다.");}
  }
  async function load() {
    const headers={"x-admin-password":password};
    const [response,stimulusResponse]=await Promise.all([
      fetch("/api/admin/summary",{headers}),fetch("/api/admin/stimuli",{headers}),
    ]);
    const result=await response.json();
    const prepared=await stimulusResponse.json();
    if(!response.ok || !stimulusResponse.ok){setError(result.error??prepared.error??"관리자 정보를 불러오지 못했습니다.");return;}
    sessionStorage.setItem("adminPassword",password);setSummary(result);setStimulus(prepared);setError("");
  }
  async function manageStimulus(action:"prepare"|"approve") {
    if(stimulusBusy) return;
    setStimulusBusy(true);setError("");
    try {
      const response=await fetch("/api/admin/stimuli",{method:"POST",headers:{"content-type":"application/json","x-admin-password":password},
        body:JSON.stringify({action})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??"관찰 자료를 준비하지 못했습니다.");
      setStimulus(result);
    } catch(cause) {setError(cause instanceof Error?cause.message:"관찰 자료를 준비하지 못했습니다.");}
    finally {setStimulusBusy(false);}
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
    {summary&&<><section className="study-admin-stimulus"><h2>P02 · 친구 A 생일 선물 자료</h2>
      <p className="body">P02에는 연구용 가상 상품과 구성된 시나리오가 사용됩니다. 상품·이미지·후기는 예시이며 실제 판매·구매 기록이 아닙니다. 네 조건 모두 같은 후보와 최종 선물을 사용합니다.</p>
      <p><strong>상태:</strong> {stimulus?.approved?"승인 완료":stimulus?.count===16?"검토 대기":"미준비"} · {stimulus?.count??0}/16개 조건 자료</p>
      {!stimulus?.count&&<button type="button" className="button" disabled={stimulusBusy} onClick={()=>void manageStimulus("prepare")}>{stimulusBusy?"후보를 준비하는 중…":"저장된 상품으로 후보 준비"}</button>}
      {!!stimulus?.candidates.length&&<div className="study-admin-products">{stimulus.candidates.map((product,index)=><article className="card" key={product.source_product_id}>
        <strong>후보 {index+1}{product.source_product_id===stimulus.finalProductId?" · 최종 선물":""}</strong>
        <img src={product.image_url} alt={product.name_ko} loading="lazy" />
        <h3>{product.name_ko}</h3><p>{product.price_krw.toLocaleString()}원 · 연구용 환산 가격</p>
        <p>{product.description_original}</p>{product.source_url&&<a href={product.source_url} target="_blank" rel="noopener noreferrer">원본 상품 페이지</a>}
      </article>)}</div>}
      {stimulus?.count===16&&!stimulus.approved&&<button type="button" className="button" disabled={stimulusBusy} onClick={()=>void manageStimulus("approve")}>{stimulusBusy?"승인 중…":"같은 세 후보와 최종 선물 확인 후 승인"}</button>}
      <p className="body">기존에 시작한 trial의 후보는 바뀌지 않습니다. 승인 전에는 새 P02 조건을 시작할 수 없습니다.</p>
    </section><div className="grid" style={{marginTop:22}}>{[
      ["등록된 사람",summary.count],["진행 중",summary.active],["완료",summary.completed],
      ["운영자 확인 필요",summary.reviewNeeded],["완료된 역할별 조건",summary.trialsCompleted],
      ["시간초과 후 미완료",summary.trialsSkipped],
    ].map(([label,value])=><div className="card" key={label}><p className="eyebrow">{label}</p><h2>{value}</h2></div>)}</div>
      <h2>조건 순서 배정</h2><pre>{JSON.stringify(summary.orderCounts,null,2)}</pre>
      <h2>참가자</h2><div className="grid">{summary.people.map((person:any)=>
        <a className="card" href={"/admin/participants/"+person.id} key={person.id}>
          <b>{person.giver_number ? `참가자 ID ${person.recipient_number} (받는 사람) / ${person.giver_number} (주는 사람)` : `이전 참가자 ID ${person.participant_number}`}</b><p>{person.status} · {person.active_role} · {person.condition_order.join(" → ")}</p>
        </a>)}</div>
      <h2>원시 데이터·계산 지표</h2><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {exports.map(name=><button className="button secondary" key={name} onClick={()=>download(name)}>{name}.csv</button>)}
      </div><h2>종이 설문 입력</h2><p className="body">설문 원본의 문항 번호를 키로 입력합니다. 조건 직후 설문은 A=C1, B=C3, C=C2, D=C4입니다.</p>
      <div className="grid">
        <label>역할별 참가번호<input className="field" value={surveyNumber} onChange={e=>setSurveyNumber(e.target.value)} placeholder="K02" /></label>
        <label>역할<select className="field" value={surveyRole} onChange={e=>setSurveyRole(e.target.value as "giver"|"recipient")}><option value="giver">선물 주는 사람</option><option value="recipient">선물 받는 사람</option></select></label>
        <label>설문 부분<select className="field" value={surveySection} onChange={e=>setSurveySection(e.target.value)}><option value="baseline">시작 전</option><option value="pretrial">과제 시작 전</option><option value="posttrial">조건 직후</option><option value="final">네 조건 이후</option><option value="crossrole">두 역할 통합</option></select></label>
        {surveySection==="posttrial"&&<label>조건<select className="field" value={surveyCondition} onChange={e=>setSurveyCondition(e.target.value as "A"|"B"|"C"|"D")}><option>A</option><option>B</option><option>C</option><option>D</option></select></label>}
        <label>설문 버전<input className="field" value={surveyVersion} onChange={e=>setSurveyVersion(e.target.value)} /></label>
        <label>종이 설문 식별번호<input className="field" value={surveyPaperId} onChange={e=>setSurveyPaperId(e.target.value)} /></label>
        <label>입력자<input className="field" value={surveyEnteredBy} onChange={e=>setSurveyEnteredBy(e.target.value)} /></label>
      </div>
      <label>문항별 응답 JSON<textarea className="field" rows={7} value={surveyAnswers} onChange={e=>setSurveyAnswers(e.target.value)} placeholder={'{"part2.ownership.1": 5, "part2.control.1": 6}'} /></label>
      <button className="button" onClick={()=>void saveSurvey()}>종이 설문 응답 저장</button>{surveySaved&&<p role="status">{surveySaved}</p>}</>}
  </section></main>;
}
