"use client";
import { useEffect, useMemo, useState } from "react";

type Role = "giver"|"recipient";
type Step = {actor:"giver"|"agent"; text:string; kind?:"dropdown"|"candidates"|"comparison"|"decision"; segment:"criteria"|"candidates"|"comparison"|"decision"};
const practiceProducts = [
  {id:"10308385",name:"올드베이 클래식 시즈닝",original:"OLD BAY Gluten Free Classic Seafood Seasoning, 6 oz Can"},
  {id:"36995775",name:"대시 오리지널 시즈닝",original:"Dash Original Seasoning Blend, Salt free, 21 oz"},
  {id:"5464020385",name:"쿠진아트 스모키 메이플 베이컨 시즈닝",original:"Cuisinart Smokey Maple Bacon Seasoning"},
];
const scenarioSteps: Step[][] = [
  [
    {actor:"giver",kind:"dropdown",segment:"criteria",text:"선택해서 입력하기 · 카테고리: 시즈닝 · 중요 기준: 일상에서 사용"},
    {actor:"giver",segment:"criteria",text:"집에서 요리를 즐기는 사람에게 줄 선물을 찾고 있어요."},
    {actor:"giver",segment:"criteria",text:"이 기준으로 후보를 찾아주세요."},
    {actor:"agent",kind:"candidates",segment:"candidates",text:"기록된 상품 정보에서 선물 후보 세 개를 찾았습니다."},
    {actor:"giver",segment:"candidates",text:"세 후보의 차이를 비교해주세요."},
    {actor:"agent",kind:"comparison",segment:"comparison",text:"세 상품의 종류와 원본 설명을 나란히 보여드립니다. 확인되지 않은 특성은 판단하지 않습니다."},
    {actor:"giver",kind:"decision",segment:"decision",text:"첫 번째 후보를 최종 선물로 선택할게요."},
    {actor:"agent",segment:"decision",text:"증여자가 선택한 최종 선물: 올드베이 클래식 시즈닝"},
  ],
  [
    {actor:"giver",kind:"dropdown",segment:"criteria",text:"선택해서 입력하기 · 카테고리: 시즈닝 · 중요 기준: 일상에서 사용"},
    {actor:"giver",segment:"criteria",text:"집에서 요리를 즐기는 사람에게 줄 선물을 찾고 있어요."},
    {actor:"agent",segment:"criteria",text:"제공된 기준으로 후보 구성과 비교를 이어가겠습니다."},
    {actor:"agent",kind:"candidates",segment:"candidates",text:"기록된 상품 정보에서 선물 후보 세 개를 찾았습니다."},
    {actor:"agent",kind:"comparison",segment:"comparison",text:"같은 세 후보를 원본 상품 정보로 비교했습니다."},
    {actor:"agent",kind:"decision",segment:"decision",text:"첫 번째 후보를 최종 선물로 결정했습니다."},
    {actor:"agent",segment:"decision",text:"AI가 선택한 최종 선물: 올드베이 클래식 시즈닝"},
  ],
];
const questions = [
  "후보 비교는 증여자의 요청으로 시작됐습니까, AI가 자동으로 시작했습니까?",
  "최종 선물을 결정한 주체는 증여자입니까, AI입니까?",
];

export function Training() {
  const [role,setRole]=useState<Role|null>(null);
  const [scenario,setScenario]=useState(0);
  const [cursor,setCursor]=useState(-1);
  const [started,setStarted]=useState(false);
  const [comparison,setComparison]=useState("");
  const [decision,setDecision]=useState("");
  const [replaySegment,setReplaySegment]=useState<string|null>(null);
  const [finished,setFinished]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [input,setInput]=useState("");
  const [selectedCategory,setSelectedCategory]=useState("시즈닝");
  const [overrides,setOverrides]=useState<Record<number,string>>({});
  const [practiceSelected,setPracticeSelected]=useState(0);
  const [pageVisible,setPageVisible]=useState(true);
  const participantId=typeof window!=="undefined"?sessionStorage.getItem("participantId")??"":"";
  const steps=scenarioSteps[scenario];
  const visibleSteps=useMemo(()=>steps.slice(0,cursor+1),[steps,cursor]);
  const active=steps[cursor];
  const next=steps[cursor+1];
  async function api(inputBody:Record<string,unknown>) {
    const response=await fetch("/api/training",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,...inputBody})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error??"연습 내용을 저장하지 못했습니다.");
    return data;
  }
  useEffect(()=>{
    if(!participantId){window.location.assign("/start");return;}
    fetch("/api/training?participantId="+encodeURIComponent(participantId),{cache:"no-store"}).then(r=>r.json()).then(data=>{
      if(data.error)throw new Error(data.error);
      const roleFromServer=data.role as Role;
      setRole(roleFromServer);
      if(data.passed){setFinished(true);return;}
      const completed=(data.checks??[]).filter((row:{passed:boolean})=>row.passed).length;
      setScenario(Math.min(1,completed));
    }).catch(e=>setError((e as Error).message));
  },[participantId]);
  useEffect(()=>{
    const onVisibility=()=>setPageVisible(document.visibilityState==="visible"&&document.hasFocus());
    onVisibility();document.addEventListener("visibilitychange",onVisibility);window.addEventListener("focus",onVisibility);window.addEventListener("blur",onVisibility);
    return()=>{document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("focus",onVisibility);window.removeEventListener("blur",onVisibility);};
  },[]);
  useEffect(()=>{
    if(!started||!role||cursor>=steps.length-1||!pageVisible)return;
    if(role==="giver"&&next?.actor==="giver")return;
    const timer=window.setTimeout(()=>setCursor(value=>Math.min(value+1,steps.length-1)),1300);
    return()=>window.clearTimeout(timer);
  },[started,role,cursor,steps,next,pageVisible]);
  useEffect(()=>{
    if(!started||cursor<0)return;
    void api({action:"practice_event",eventType:"practice_step_shown",scenarioIndex:scenario,step:cursor}).catch(()=>{});
  },[cursor,started,scenario]);
  function start() {
    setStarted(true);setCursor(role==="giver"?-1:0);setReplaySegment(null);
    void api({action:"practice_event",eventType:"observation_started",scenarioIndex:scenario}).catch(e=>setError((e as Error).message));
  }
  function send() {
    if(!input.trim()||!next||next.actor!=="giver")return;
    // Practice text is visibly the participant's input; the prepared agent reply is labelled as scripted.
    setOverrides(old=>({...old,[cursor+1]:input.trim()}));
    setCursor(value=>value+1);setInput("");
  }
  async function check() {
    setBusy(true);setError("");
    try {
      const data=await api({action:"check",scenarioIndex:scenario,comparison,decision});
      if(!data.passed){setReplaySegment(data.replayPhase);return;}
      if(scenario===0){setScenario(1);setCursor(-1);setStarted(false);setComparison("");setDecision("");setReplaySegment(null);setOverrides({});setPracticeSelected(0);return;}
      await api({action:"complete"});setFinished(true);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function replay() {
    const index=replaySegment==="comparison"&&scenario===0?4:steps.findIndex(step=>step.segment===replaySegment);
    setCursor(Math.max(0,index-1));setReplaySegment(null);setComparison("");setDecision("");setStarted(true);
    void api({action:"practice_event",eventType:"practice_replayed",scenarioIndex:scenario}).catch(()=>{});
  }
  if(!role)return <section className="panel"><p>참가자 역할을 확인하고 있습니다.</p>{error&&<p role="alert">{error}</p>}</section>;
  if(finished)return <section className="panel" style={{maxWidth:820,margin:"24px auto"}}><p className="eyebrow">역할별 연습 완료</p><h1 className="title">연구를 시작할 수 있습니다</h1><p className="body">본실험에서는 과업 진행 방식과 최종 결정 주체의 다른 조합도 나타날 수 있습니다. 심리척도는 종이 설문으로 응답합니다.</p><a className="button" href={role==="giver"?"/experiment/giver":"/experiment/recipient"}>본실험 시작</a></section>;
  return <main className="experiment-shell"><header className="experiment-header"><p className="eyebrow">{role==="recipient"?"수혜자 관찰 연습":"증여자 조작 연습"} · {scenario+1} / 2</p><h1 className="title">추천 과정 알아보기</h1><p className="body">{role==="recipient"?"당신은 선물을 받는 사람입니다. 상대가 AI를 이용해 당신에게 줄 선물을 고르는 과정을 살펴보게 됩니다.":"당신은 선물을 고르는 사람입니다. 대화와 선택 메뉴로 기준을 입력하고, 허용된 단계에서 후보 구성·비교·최종 선택을 진행합니다."}</p><p className="body">이 화면은 연구자가 구성한 연습용 시나리오입니다. 실제 상대의 행동이나 실제 판매가격을 보여주는 것이 아닙니다.</p></header>
    {error&&<p role="alert" className="experiment-error">{error}</p>}
    {!started?<section className="experiment-task card"><h2>{scenario===0?"증여자 요청과 증여자 최종 선택":"AI 자동 진행과 AI 최종 선택"}</h2><p className="body">증여자의 입력, 상품 후보, 비교, 결정을 시간순으로 확인합니다.</p><button type="button" className="button" onClick={start}>{role==="recipient"?"관찰 시작":"연습 시작"}</button></section>:<>
      <section className="experiment-transcript" aria-label="연습용 대화 재생"><h2>증여자와 AI의 대화</h2>{visibleSteps.map((step,index)=><article key={index} className={"experiment-message "+(step.actor==="agent"?"from-agent":"from-person")}><p className="experiment-speaker">{step.actor==="agent"?"AI":"증여자"} · {step.kind==="dropdown"?"드롭다운 선택":step.segment==="decision"?"최종 결정":step.segment==="comparison"?"후보 비교":"대화"}</p><p className="body">{role==="giver"&&scenario===0&&index===steps.length-1&&practiceSelected?`증여자가 선택한 최종 선물: ${practiceProducts[practiceSelected-1].name}`:overrides[index]??step.text}</p>{step.kind==="dropdown"&&<div className="scripted-dropdown"><label>카테고리<select disabled value="시즈닝"><option>시즈닝</option></select></label><label>중요 기준<select disabled value="일상에서 사용"><option>일상에서 사용</option></select></label></div>}{step.kind==="candidates"&&<div className="experiment-card-list">{practiceProducts.map((product,i)=><div className="experiment-candidate" key={product.id}><b>후보 {i+1} · {product.name}</b><p className="body">원본명: {product.original}</p><p className="eyebrow">연습용 상품 정보 · 가격 생략</p></div>)}</div>}{step.kind==="comparison"&&<div className="experiment-table-wrap"><table className="experiment-table"><thead><tr><th>후보</th><th>원본에서 확인할 항목</th></tr></thead><tbody>{practiceProducts.map((p,i)=><tr key={p.id}><th>{i+1}. {p.name}</th><td>종류·구성·원본 설명</td></tr>)}</tbody></table></div>}</article>)}</section>
      {role==="giver"&&next?.actor==="giver"&&<section className="experiment-task card"><p className="eyebrow">증여자 입력</p>{next.kind==="dropdown"?<><label>선택해서 입력하기<select className="field" value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value)}><option>시즈닝</option></select></label><button className="button" onClick={()=>{setOverrides(old=>({...old,[cursor+1]:`선택해서 입력하기 · 카테고리: ${selectedCategory}`}));setCursor(c=>c+1);}}>조건 적용</button></>:next.kind==="decision"?<><p className="body">최종 선물을 직접 선택해 주세요.</p><div className="training-choice">{practiceProducts.map((product,i)=><button className="button secondary" key={product.id} onClick={()=>{setPracticeSelected(i+1);setOverrides(old=>({...old,[cursor+1]:`${i+1}번 후보 ${product.name}로 할게요.`}));setCursor(c=>c+1);}}>{i+1}번 · {product.name}</button>)}</div></>:<><label>대화 입력<input className="field" value={input} onChange={e=>setInput(e.target.value)} placeholder={next.text}/></label><button className="button" disabled={!input.trim()} onClick={send}>전송</button></>}</section>}
      {cursor===steps.length-1&&<section className="experiment-task card"><h2>방금 본 행동 확인</h2>{replaySegment&&<><p role="alert">해당 행동을 다시 살펴봐 주세요.</p><button className="button secondary" onClick={replay}>해당 구간 다시 보기</button></>}{!replaySegment&&<><p className="body">{questions[0]}</p><div className="training-choice"><label><input type="radio" name="comparison" checked={comparison==="giver"} onChange={()=>setComparison("giver")}/> 증여자 요청</label><label><input type="radio" name="comparison" checked={comparison==="agent"} onChange={()=>setComparison("agent")}/> AI 자동 진행</label></div><p className="body">{questions[1]}</p><div className="training-choice"><label><input type="radio" name="decision" checked={decision==="giver"} onChange={()=>setDecision("giver")}/> 증여자</label><label><input type="radio" name="decision" checked={decision==="agent"} onChange={()=>setDecision("agent")}/> AI</label></div><button className="button" disabled={!comparison||!decision||busy} onClick={()=>void check()}>{busy?"확인 중…":"답변 확인"}</button></>}</section>}
    </>}
  </main>;
}
