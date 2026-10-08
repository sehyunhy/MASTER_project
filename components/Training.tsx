"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Role = "giver"|"recipient";
type Step = {actor:"giver"|"agent"; text:string; kind?:"dropdown"|"candidates"|"comparison"|"decision"; segment:"criteria"|"candidates"|"comparison"|"decision"};
type CatalogPracticeProduct = {
  source_product_id:string; product_name_ko:string|null; product_name_original:string;
  category:string; price_experiment:number; price_original:number; image_url:string;
  description:string; source_url:string|null; source_timestamp_raw:string|null;
};
const practiceFacts: Record<string,{kind:string;size:string;use:string}> = {
  "10308385":{kind:"허브·향신료 혼합 시즈닝",size:"6 oz 캔",use:"원본 설명에 해산물 요리 등에 사용한다고 기재되어 있습니다."},
  "36995775":{kind:"무염 향신료 혼합 시즈닝",size:"21 oz 병",use:"원본 설명에 여러 요리에 곁들이는 향신료 혼합 제품이라고 기재되어 있습니다."},
  "864008591":{kind:"네이비 블루 PVC·폴리에스터 테이블 러너",size:"14 × 72인치",use:"원본 설명에 식탁 위에 놓는 패브릭 소품이라고 기재되어 있습니다."},
};
const scenarioSteps: Step[][] = [
  [
    {actor:"giver",kind:"dropdown",segment:"criteria",text:"선택해서 입력하기 · 카테고리: 전체 · 중요 기준: 실용성"},
    {actor:"giver",segment:"criteria",text:"집에서 요리를 즐기는 사람에게 줄 선물을 찾고 있어요."},
    {actor:"giver",segment:"criteria",text:"이 기준으로 후보를 찾아주세요."},
    {actor:"agent",kind:"candidates",segment:"candidates",text:"기록된 상품 정보에서 선물 후보 세 개를 찾았습니다."},
    {actor:"giver",segment:"candidates",text:"세 후보의 차이를 비교해주세요."},
    {actor:"agent",kind:"comparison",segment:"comparison",text:"세 상품의 종류와 원본 설명을 나란히 보여드립니다. 확인되지 않은 특성은 판단하지 않습니다."},
    {actor:"giver",kind:"decision",segment:"decision",text:"첫 번째 후보를 최종 선물로 선택할게요."},
    {actor:"agent",segment:"decision",text:"선물 주는 사람이 선택한 최종 선물: 올드베이 클래식 시즈닝"},
  ],
  [
    {actor:"giver",kind:"dropdown",segment:"criteria",text:"선택해서 입력하기 · 카테고리: 전체 · 중요 기준: 실용성"},
    {actor:"giver",segment:"criteria",text:"집에서 요리를 즐기는 사람에게 줄 선물을 찾고 있어요."},
    {actor:"agent",segment:"criteria",text:"제공된 기준으로 후보 구성과 비교를 이어가겠습니다."},
    {actor:"agent",kind:"candidates",segment:"candidates",text:"기록된 상품 정보에서 선물 후보 세 개를 찾았습니다."},
    {actor:"agent",kind:"comparison",segment:"comparison",text:"같은 세 후보를 원본 상품 정보로 비교했습니다."},
    {actor:"agent",kind:"decision",segment:"decision",text:"첫 번째 후보를 최종 선물로 결정했습니다."},
    {actor:"agent",segment:"decision",text:"AI가 선택한 최종 선물: 올드베이 클래식 시즈닝"},
  ],
];
const questions = [
  "후보 비교는 AI가 선물 주는 사람의 요청으로 시작됐습니까, AI가 자동으로 시작했습니까?",
  "최종 선물을 결정한 주체는 선물 주는 사람입니까, AI입니까?",
];
const practiceStages = [
  {id:"criteria",label:"기준 입력"},
  {id:"candidates",label:"후보 확인"},
  {id:"comparison",label:"후보 비교"},
  {id:"decision",label:"최종 결정"},
] as const;

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
  const [selectedPriority,setSelectedPriority]=useState("실용성");
  const [catalogProducts,setCatalogProducts]=useState<CatalogPracticeProduct[]>([]);
  const [openDetails,setOpenDetails]=useState<string[]>([]);
  const [overrides,setOverrides]=useState<Record<number,string>>({});
  const [practiceSelected,setPracticeSelected]=useState(0);
  const [pageVisible,setPageVisible]=useState(true);
  const newestStepRef=useRef<HTMLElement|null>(null);
  const practiceProducts=useMemo(()=>catalogProducts.map(product=>({
    ...product,id:product.source_product_id,name:product.product_name_ko??product.product_name_original,
    original:product.product_name_original,
    facts:practiceFacts[product.source_product_id],
  })),[catalogProducts]);
  const participantId=typeof window!=="undefined"?sessionStorage.getItem("participantId")??"":"";
  const steps=scenarioSteps[scenario];
  const visibleSteps=useMemo(()=>steps.slice(0,cursor+1),[steps,cursor]);
  const active=steps[cursor];
  const next=steps[cursor+1];
  const currentStage=active?.segment??next?.segment??"criteria";
  const currentStageIndex=practiceStages.findIndex(stage=>stage.id===currentStage);
  useEffect(()=>{
    if(!started||cursor<0||!pageVisible)return;
    const frame=requestAnimationFrame(()=>newestStepRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));
    return()=>cancelAnimationFrame(frame);
  },[started,cursor,pageVisible]);
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
      if(data.passed){setRole(roleFromServer);setFinished(true);return;}
      setCatalogProducts(data.practiceProducts??[]);
      setRole(roleFromServer);
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
    if(!started||!role||cursor>=steps.length-1||!pageVisible||openDetails.length)return;
    if(role==="giver"&&next?.actor==="giver")return;
    const dwell=active?.kind==="candidates"||active?.kind==="comparison"?12000:1300;
    const timer=window.setTimeout(()=>setCursor(value=>Math.min(value+1,steps.length-1)),dwell);
    return()=>window.clearTimeout(timer);
  },[started,role,cursor,steps,next,active,pageVisible,openDetails.length]);
  useEffect(()=>{
    if(!started||cursor<0)return;
    void api({action:"practice_event",eventType:"practice_step_shown",scenarioIndex:scenario,step:cursor}).catch(()=>{});
  },[cursor,started,scenario]);
  function start() {
    setStarted(true);setCursor(role==="giver"?-1:0);setReplaySegment(null);setOpenDetails([]);
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
      if(scenario===0){setScenario(1);setCursor(-1);setStarted(false);setComparison("");setDecision("");setReplaySegment(null);setOverrides({});setPracticeSelected(0);setOpenDetails([]);return;}
      await api({action:"complete"});setFinished(true);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function replay() {
    const index=replaySegment==="comparison"&&scenario===0?4:steps.findIndex(step=>step.segment===replaySegment);
    setCursor(Math.max(0,index-1));setReplaySegment(null);setComparison("");setDecision("");setStarted(true);
    void api({action:"practice_event",eventType:"practice_replayed",scenarioIndex:scenario}).catch(()=>{});
  }
  if(!role)return <section className="panel"><p>참가자 역할을 확인하고 있습니다.</p>{error&&<p role="alert">{error}</p>}</section>;
  if(finished)return <main className="experiment-shell training-shell"><section className="panel" style={{maxWidth:820,margin:"24px auto"}}><p className="eyebrow">역할별 연습 완료</p><h1 className="title">연구를 시작할 수 있습니다</h1><p className="body">본실험에서는 과업 진행 방식과 최종 결정 주체의 다른 조합도 나타날 수 있습니다. 심리척도는 종이 설문으로 응답합니다.</p><a className="button" href={role==="giver"?"/experiment/giver":"/experiment/recipient"}>본실험 시작</a></section></main>;
  return <main className="experiment-shell training-shell">
    <header className="experiment-header">
      <div className="experiment-brand"><strong>AI 선물 에이전트</strong><span>연습 {scenario+1} / 2</span></div>
      <p className="eyebrow">{role==="recipient"?"선물 받는 사람 관찰 연습":"선물 주는 사람 조작 연습"}</p>
      <h1 className="title">추천 과정 알아보기</h1>
      <p className="body">{role==="recipient"?"당신은 선물을 받는 사람입니다. 선물 주는 사람이 AI를 이용해 당신에게 줄 선물을 고르는 과정을 살펴보게 됩니다.":"당신은 선물을 주는 사람입니다. 대화와 선택 메뉴로 기준을 입력하고, 허용된 단계에서 후보 구성·비교·최종 선택을 진행합니다."}</p>
      <p className="body">이 화면은 연구자가 구성한 연습용 시나리오입니다. 가격은 2024년 상품 기록을 연구용으로 고정 환산한 값이며 현재 판매가격이 아닙니다. 상품 상세를 열어 보는 동안 대화 재생이 멈춥니다.</p>
    </header>
    <ol className="experiment-phase-step" aria-label="연습 진행 단계">{practiceStages.map((stage,index)=><li key={stage.id} className={index===currentStageIndex?"is-active":index<currentStageIndex?"is-complete":""} aria-current={index===currentStageIndex?"step":undefined}><span>{index+1}</span>{stage.label}</li>)}</ol>
    {error&&<p role="alert" className="experiment-error">{error}</p>}
    {!started?<section className="experiment-task card"><h2>{scenario===0?"선물 주는 사람 요청과 선물 주는 사람 최종 선택":"AI 자동 진행과 AI 최종 선택"}</h2><p className="body">선물 주는 사람의 입력, 상품 후보, 비교, 결정을 시간순으로 확인합니다.</p><button type="button" className="button" onClick={start}>{role==="recipient"?"관찰 시작":"연습 시작"}</button></section>:<>
      <section className="experiment-transcript" aria-label="연습용 대화 재생">
        <h2>선물 주는 사람과 AI의 대화</h2>
        {visibleSteps.map((step,index)=><article key={index} ref={index===visibleSteps.length-1?newestStepRef:null} className={"experiment-message "+(step.actor==="agent"?"from-agent":"from-person")}>
          <p className="experiment-speaker">{step.actor==="agent"?"AI":"선물 주는 사람"} · {step.kind==="dropdown"?"드롭다운 선택":step.segment==="decision"?"최종 결정":step.segment==="comparison"?"후보 비교":"대화"}</p>
          <div className="experiment-message-bubble"><p className="body">{role==="giver"&&scenario===0&&index===steps.length-1&&practiceSelected?`선물 주는 사람이 선택한 최종 선물: ${practiceProducts[practiceSelected-1].name}`:overrides[index]??step.text}</p></div>
          {step.kind==="dropdown"&&<div className="scripted-dropdown"><label>카테고리<select disabled value="전체"><option>전체</option></select></label><label>중요 기준<select disabled value={role==="giver"?selectedPriority:"실용성"}><option>{role==="giver"?selectedPriority:"실용성"}</option></select></label></div>}
          {step.kind==="candidates"&&<div className="experiment-card-list">{practiceProducts.map((product,i)=><div className="experiment-candidate" key={product.id}>
            <div className="experiment-candidate-summary"><span className="experiment-candidate-label">후보 {i+1} · {product.facts?.kind??product.category}</span><strong className="experiment-price">{Number(product.price_experiment).toLocaleString()}원</strong></div>
            <img className="experiment-product-image" src={product.image_url} alt={`${product.name} 원본 상품 이미지`} loading="eager" onError={event=>{const image=event.currentTarget;if(image.getAttribute("src")!=="/products/category-illustration.svg")image.src="/products/category-illustration.svg";image.alt="원본 상품 이미지를 불러올 수 없습니다";}} />
            <h3>{product.name}</h3><p className="body">{product.facts?.use}</p><p className="body"><strong>종류·구성:</strong> {product.facts?.kind} · {product.facts?.size}</p>
            <p className="eyebrow">연구용 고정 가격 · 원본 기록 ${Number(product.price_original).toFixed(2)} (USD, {product.source_timestamp_raw?.slice(0,10)??"2024-08"})</p>
            <details onToggle={event=>{const isOpen=event.currentTarget.open;setOpenDetails(old=>isOpen?[...new Set([...old,product.id])]:old.filter(id=>id!==product.id));if(isOpen)void api({action:"practice_event",eventType:"practice_product_detail_opened",scenarioIndex:scenario,sourceProductId:product.id}).catch(()=>{});}}><summary>원본 상품 정보 보기</summary><p className="body">{product.original}</p><p className="body">{product.description.slice(0,420)}{product.description.length>420?"…":""}</p>{product.source_url?.startsWith("https://www.walmart.com/")&&<a href={product.source_url} target="_blank" rel="noopener noreferrer">CSV에 기록된 상품 링크 (현재 내용은 다를 수 있음)</a>}</details>
          </div>)}</div>}
          {step.kind==="comparison"&&<div className="experiment-table-wrap"><table className="experiment-table"><thead><tr><th>비교 기준</th>{practiceProducts.map((p,i)=><th key={p.id}>{i+1}. {p.name}</th>)}</tr></thead><tbody>
            <tr><th>연구용 고정 가격</th>{practiceProducts.map(p=><td key={p.id}>{Number(p.price_experiment).toLocaleString()}원</td>)}</tr>
            <tr><th>종류·구성</th>{practiceProducts.map(p=><td key={p.id}>{p.facts?.kind} · {p.facts?.size}</td>)}</tr>
            <tr><th>원본 설명의 사용 상황</th>{practiceProducts.map(p=><td key={p.id}>{p.facts?.use}</td>)}</tr>
            <tr><th>원본 USD 기록</th>{practiceProducts.map(p=><td key={p.id}>${Number(p.price_original).toFixed(2)}</td>)}</tr>
          </tbody></table></div>}
        </article>)}
      </section>
      {role==="giver"&&next?.actor==="giver"&&<section className="experiment-composer experiment-task card"><p className="eyebrow">선물 주는 사람 입력</p>{next.kind==="dropdown"?<><label>상품 카테고리<select className="field" value="전체" disabled><option value="전체">전체</option></select></label><label>가장 중요한 기준<select className="field" value={selectedPriority} onChange={e=>setSelectedPriority(e.target.value)}><option value="실용성">실용성</option><option value="취향 적합성">취향 적합성</option><option value="개인적 의미">개인적 의미</option></select></label><button className="button" onClick={()=>{setOverrides(old=>({...old,[cursor+1]:`선택해서 입력하기 · 카테고리: 전체 · 중요 기준: ${selectedPriority}`}));setCursor(c=>c+1);}}>조건 적용</button></>:next.kind==="decision"?<><p className="body">최종 선물을 직접 선택해 주세요.</p><div className="training-choice">{practiceProducts.map((product,i)=><button className="button secondary" key={product.id} onClick={()=>{setPracticeSelected(i+1);setOverrides(old=>({...old,[cursor+1]:`${i+1}번 후보 ${product.name}로 할게요.`}));setCursor(c=>c+1);}}>{i+1}번 · {product.name}</button>)}</div></>:<><label>대화 입력<input className="field" value={input} onChange={e=>setInput(e.target.value)} placeholder={next.text}/></label><button className="button" disabled={!input.trim()} onClick={send}>전송</button></>}</section>}
      {cursor===steps.length-1&&<section className="experiment-task card"><h2>방금 본 행동 확인</h2>{replaySegment&&<><p role="alert">해당 행동을 다시 살펴봐 주세요.</p><button className="button secondary" onClick={replay}>해당 구간 다시 보기</button></>}{!replaySegment&&<><p className="body">{questions[0]}</p><div className="training-choice"><label><input type="radio" name="comparison" checked={comparison==="giver"} onChange={()=>setComparison("giver")}/> 선물 주는 사람 요청</label><label><input type="radio" name="comparison" checked={comparison==="agent"} onChange={()=>setComparison("agent")}/> AI 자동 진행</label></div><p className="body">{questions[1]}</p><div className="training-choice"><label><input type="radio" name="decision" checked={decision==="giver"} onChange={()=>setDecision("giver")}/> 선물 주는 사람</label><label><input type="radio" name="decision" checked={decision==="agent"} onChange={()=>setDecision("agent")}/> AI</label></div><button className="button" disabled={!comparison||!decision||busy} onClick={()=>void check()}>{busy?"확인 중…":"답변 확인"}</button></>}</section>}
    </>}
  </main>;
}
