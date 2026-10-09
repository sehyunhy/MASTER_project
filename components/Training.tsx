"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MINIMUM_EXPOSURE_MS, PROFILES } from "@/config/experiment";
import { productSummaryKo } from "@/lib/catalog/productSummaryKo";
import { buildProductComparisonEvidence } from "@/lib/catalog/productEvidence";

type Role = "giver"|"recipient";
type Step = {actor:"giver"|"agent"; text:string; kind?:"dropdown"|"candidates"|"comparison"|"decision"; segment:"criteria"|"candidates"|"comparison"|"decision"};
type CatalogPracticeProduct = {
  source_product_id:string; product_name_ko:string|null; product_name_original:string;
  category:string; price_experiment:number; price_original:number; image_url:string;
  description:string; source_url:string|null; source_timestamp_raw:string|null;
};
type PracticeResultTab = "candidates"|"comparison"|"decision";
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
    {actor:"agent",kind:"comparison",segment:"comparison",text:"세 후보의 연구용 가격, 확인된 특징, 선물 적합성과 살펴볼 점을 나란히 비교했습니다."},
    {actor:"giver",kind:"decision",segment:"decision",text:"첫 번째 후보를 최종 선물로 선택할게요."},
    {actor:"agent",segment:"decision",text:"선물 주는 사람이 선택한 최종 선물: 올드베이 클래식 시즈닝"},
  ],
  [
    {actor:"agent",segment:"criteria",text:"제공된 선물 받는 사람의 관심사·선호와 고정 예산 50,000원을 확인했습니다. 추가 입력 없이 상품 정보를 살펴보겠습니다."},
    {actor:"agent",kind:"candidates",segment:"candidates",text:"기록된 상품 정보에서 선물 후보 세 개를 찾았습니다."},
    {actor:"agent",kind:"comparison",segment:"comparison",text:"같은 세 후보의 연구용 가격, 확인된 특징, 선물 적합성과 살펴볼 점을 비교했습니다."},
    {actor:"agent",kind:"decision",segment:"decision",text:"세 후보의 기록된 상품 정보를 비교한 뒤 첫 번째 후보를 최종 선물로 결정했습니다."},
  ],
];
const questions = [
  "후보 비교는 Agent가 선물 주는 사람의 요청으로 시작됐습니까, Agent가 자동으로 시작했습니까?",
  "최종 선물을 결정한 주체는 선물 주는 사람입니까, Agent입니까?",
];
const practiceStages = [
  {id:"criteria",label:"기준 입력"},
  {id:"candidates",label:"후보 확인"},
  {id:"comparison",label:"후보 비교"},
  {id:"decision",label:"최종 결정"},
] as const;
const practiceComparisonFields: [string,string][] = [
  ["price","가격"],["budget_fit","예산 적합성"],["core_features","핵심 특징·목적"],
  ["recipient_fit","관심사·취향 연결"],["practicality","실용성"],["emotional_meaning","감성적 측면"],
  ["comparative_strength","다른 후보 대비 강점"],["consideration","선택 전 고려할 점"],["best_for","우선할 기준"],
];
const TIMED_PRACTICE_SEGMENTS = new Set(["criteria","candidates","comparison"]);
const practiceProfile = PROFILES.find(profile=>profile.id==="R4v2");

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
  const [stageExposureMs,setStageExposureMs]=useState(0);
  const [overrides,setOverrides]=useState<Record<number,string>>({});
  const [practiceSelected,setPracticeSelected]=useState(0);
  const [pageVisible,setPageVisible]=useState(true);
  const [serverPhaseReady,setServerPhaseReady]=useState("");
  const [verifiedPhaseKey,setVerifiedPhaseKey]=useState("");
  const [resultTab,setResultTab]=useState<PracticeResultTab>("candidates");
  const [detailProductId,setDetailProductId]=useState<string|null>(null);
  const transcriptScrollRef=useRef<HTMLDivElement|null>(null);
  const transcriptPinnedToBottom=useRef(true);
  const stageClock=useRef({key:"",elapsed:0,lastTick:0});
  const practiceRunId=useRef("");
  const advancing=useRef(false);
  const lastGateAttempt=useRef(0);
  const practiceProducts=useMemo(()=>catalogProducts.map(product=>({
    ...product,id:product.source_product_id,name:product.product_name_ko??product.product_name_original,
    original:product.product_name_original,
    facts:practiceFacts[product.source_product_id],
  })),[catalogProducts]);
  const practiceComparisonRows=useMemo(()=>{
    const candidates=practiceProducts.map((product,index)=>({
      display_order:index+1,
      product_snapshot:{
        source_product_id:product.id,product_name:product.name,category:product.category,
        price:product.price_experiment,description:product.description,
      },
    }));
    return candidates.map((candidate,index)=>({
      label:String.fromCharCode(65+index),product_name:practiceProducts[index].name,
      price:practiceProducts[index].price_experiment,
      ...buildProductComparisonEvidence(candidate,candidates,{
        profile:practiceProfile,budget:practiceProfile?.gift_budget,
        priorities:scenario===0?[selectedPriority]:[],
      }),
    }));
  },[practiceProducts,scenario,selectedPriority]);
  const participantId=typeof window!=="undefined"?sessionStorage.getItem("participantId")??"":"";
  const steps=scenarioSteps[scenario];
  const visibleSteps=useMemo(()=>steps.slice(0,cursor+1),[steps,cursor]);
  const candidatesVisible=visibleSteps.some(step=>step.kind==="candidates");
  const comparisonVisible=visibleSteps.some(step=>step.kind==="comparison");
  const decisionVisible=visibleSteps.some(step=>step.kind==="decision");
  const active=steps[cursor];
  const next=steps[cursor+1];
  const currentStage=active?.segment??next?.segment??"criteria";
  const currentStageIndex=practiceStages.findIndex(stage=>stage.id===currentStage);
  const minimumPracticeExposureMs=MINIMUM_EXPOSURE_MS.practice[role??"giver"];
  const showExposureClock=started&&TIMED_PRACTICE_SEGMENTS.has(currentStage);
  const stageKey=`${scenario}:${currentStage}`;
  const exposureVerified=verifiedPhaseKey===stageKey;
  const remainingStageSeconds=Math.max(0,Math.ceil((minimumPracticeExposureMs-stageExposureMs)/1000));
  const finalProduct=decisionVisible?practiceProducts[scenario===1?0:Math.max(0,practiceSelected-1)]:null;
  const detailProduct=practiceProducts.find(product=>product.id===detailProductId);
  const currentTask=!started?"연습을 시작해 주세요.":cursor===steps.length-1?"방금 본 행동을 확인해 주세요.":role==="recipient"?"선물 주는 사람과 Agent의 행동을 관찰해 주세요.":scenario===1?"제공된 정보를 바탕으로 Agent의 진행을 확인해 주세요.":next?.kind==="dropdown"?"추천 기준을 선택해 주세요.":next?.kind==="decision"?"비교를 확인한 뒤 최종 선물을 선택해 주세요.":next?.actor==="giver"?"대화로 현재 과업을 요청해 주세요.":"Agent의 응답을 확인해 주세요.";
  useEffect(()=>{
    if(!started||cursor<0||!pageVisible)return;
    const frame=requestAnimationFrame(()=>{
      const pane=transcriptScrollRef.current;
      if(pane&&transcriptPinnedToBottom.current)pane.scrollTop=pane.scrollHeight;
    });
    return()=>cancelAnimationFrame(frame);
  },[started,cursor,pageVisible]);
  useEffect(()=>{
    if(currentStage==="decision"&&decisionVisible)setResultTab("decision");
    else if(currentStage==="comparison"&&comparisonVisible)setResultTab("comparison");
    else setResultTab("candidates");
  },[scenario,currentStage,candidatesVisible,comparisonVisible,decisionVisible]);
  useEffect(()=>{
    if(!detailProductId)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setDetailProductId(null);};
    window.addEventListener("keydown",close);
    return()=>window.removeEventListener("keydown",close);
  },[detailProductId]);
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
    if(!showExposureClock)return;
    if(stageClock.current.key!==stageKey){stageClock.current={key:stageKey,elapsed:0,lastTick:performance.now()};setStageExposureMs(0);}
    if(!pageVisible){stageClock.current.lastTick=0;return;}
    stageClock.current.lastTick=performance.now();
    const timer=window.setInterval(()=>{
      const now=performance.now();
      const delta=Math.max(0,Math.min(1000,now-stageClock.current.lastTick));
      stageClock.current.elapsed+=delta;stageClock.current.lastTick=now;
      setStageExposureMs(Math.floor(stageClock.current.elapsed));
    },250);
    return()=>window.clearInterval(timer);
  },[showExposureClock,stageKey,pageVisible]);
  useEffect(()=>{
    if(!showExposureClock||!practiceRunId.current)return;
    let cancelled=false;
    setServerPhaseReady("");setVerifiedPhaseKey("");
    void api({action:"practice_exposure",operation:"begin",practiceRunId:practiceRunId.current,scenarioIndex:scenario,phase:currentStage})
      .then(()=>{if(!cancelled)setServerPhaseReady(stageKey);})
      .catch(e=>{if(!cancelled)setError((e as Error).message);});
    return()=>{cancelled=true;};
  },[showExposureClock,stageKey,scenario,currentStage]);
  useEffect(()=>{
    if(!showExposureClock||serverPhaseReady!==stageKey||!practiceRunId.current)return;
    const send=(active:boolean)=>{void api({action:"practice_exposure",operation:"heartbeat",practiceRunId:practiceRunId.current,scenarioIndex:scenario,phase:currentStage,active}).catch(e=>setError((e as Error).message));};
    send(pageVisible);
    if(!pageVisible)return;
    const timer=window.setInterval(()=>send(true),2_000);
    return()=>window.clearInterval(timer);
  },[showExposureClock,serverPhaseReady,stageKey,scenario,currentStage,pageVisible]);
  useEffect(()=>{
    if(!showExposureClock||!pageVisible||stageClock.current.key!==stageKey||stageClock.current.elapsed<minimumPracticeExposureMs||serverPhaseReady!==stageKey||verifiedPhaseKey===stageKey||advancing.current||Date.now()-lastGateAttempt.current<1_000)return;
    advancing.current=true;lastGateAttempt.current=Date.now();
    void api({action:"practice_exposure",operation:"gate",practiceRunId:practiceRunId.current,scenarioIndex:scenario,phase:currentStage})
      .then(result=>{if(result.passed)setVerifiedPhaseKey(stageKey);})
      .catch(e=>setError((e as Error).message))
      .finally(()=>{advancing.current=false;});
  },[showExposureClock,pageVisible,stageKey,stageExposureMs,minimumPracticeExposureMs,serverPhaseReady,verifiedPhaseKey,scenario,currentStage]);
  async function completePracticePhase() {
    if(!pageVisible||verifiedPhaseKey!==stageKey)return false;
    const result=await api({action:"practice_exposure",operation:"complete",practiceRunId:practiceRunId.current,scenarioIndex:scenario,phase:currentStage});
    return result.passed===true;
  }
  useEffect(()=>{
    if(!started||!role||cursor>=steps.length-1||!pageVisible)return;
    if(role==="giver"&&next?.actor==="giver")return;
    if(active&&next?.segment!==active.segment&&TIMED_PRACTICE_SEGMENTS.has(active.segment))return;
    const dwell=role==="giver"&&(active?.kind==="candidates"||active?.kind==="comparison")?12000:1300;
    const timer=window.setTimeout(()=>setCursor(value=>Math.min(value+1,steps.length-1)),dwell);
    return()=>window.clearTimeout(timer);
  },[started,role,cursor,steps,next,active,pageVisible]);
  useEffect(()=>{
    if(!started||!pageVisible||!active||!next||next.segment===active.segment||!TIMED_PRACTICE_SEGMENTS.has(active.segment))return;
    if(role==="giver"&&next.actor==="giver")return;
    if(verifiedPhaseKey!==stageKey||advancing.current)return;
    advancing.current=true;
    void completePracticePhase().then(passed=>{if(passed)setCursor(value=>Math.min(value+1,steps.length-1));}).catch(e=>setError((e as Error).message)).finally(()=>{advancing.current=false;});
  },[started,pageVisible,role,cursor,active,next,steps.length,stageKey,verifiedPhaseKey,stageExposureMs]);
  useEffect(()=>{
    if(!started||cursor<0)return;
    void api({action:"practice_event",eventType:"practice_step_shown",scenarioIndex:scenario,step:cursor}).catch(()=>{});
  },[cursor,started,scenario]);
  function start() {
    practiceRunId.current=crypto.randomUUID();setServerPhaseReady("");setVerifiedPhaseKey("");
    transcriptPinnedToBottom.current=true;setResultTab("candidates");setDetailProductId(null);
    stageClock.current={key:"",elapsed:0,lastTick:0};setStageExposureMs(0);
    setStarted(true);setCursor(role==="giver"&&scenario===0?-1:0);setReplaySegment(null);
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
      const data=await api({action:"check",practiceRunId:practiceRunId.current,scenarioIndex:scenario,comparison,decision});
      if(!data.passed){setReplaySegment(data.replayPhase);return;}
      if(scenario===0){setScenario(1);setCursor(-1);setStarted(false);setComparison("");setDecision("");setReplaySegment(null);setOverrides({});setPracticeSelected(0);setResultTab("candidates");setDetailProductId(null);practiceRunId.current="";setServerPhaseReady("");setVerifiedPhaseKey("");stageClock.current={key:"",elapsed:0,lastTick:0};setStageExposureMs(0);return;}
      await api({action:"complete"});setFinished(true);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function replay() {
    const index=replaySegment==="comparison"&&scenario===0?4:steps.findIndex(step=>step.segment===replaySegment);
    stageClock.current={key:"",elapsed:0,lastTick:0};setStageExposureMs(0);
    setCursor(Math.max(0,index-1));setReplaySegment(null);setComparison("");setDecision("");setStarted(true);
    void api({action:"practice_event",eventType:"practice_replayed",scenarioIndex:scenario}).catch(()=>{});
  }
  async function choosePracticeProduct(index:number,productName:string) {
    if(advancing.current)return;
    advancing.current=true;
    try {
      if(!await completePracticePhase()){setError(`후보 비교 내용을 ${minimumPracticeExposureMs/1000}초 동안 확인한 뒤 선택해 주세요.`);return;}
      setError("");setPracticeSelected(index+1);
      setOverrides(old=>({...old,[cursor+1]:`${index+1}번 후보 ${productName}로 할게요.`}));
      setCursor(value=>value+1);
    } catch(e) {setError((e as Error).message);} finally {advancing.current=false;}
  }
  function openProductDetail(productId:string) {
    setDetailProductId(productId);
    void api({action:"practice_event",eventType:"practice_product_detail_opened",scenarioIndex:scenario,sourceProductId:productId}).catch(()=>{});
  }
  function productCard(product:(typeof practiceProducts)[number],index:number,selected=false) {
    return <div className={`experiment-candidate${selected?" is-selected":""}`} key={product.id}>
      <div className="experiment-candidate-summary"><span className="experiment-candidate-label">후보 {index+1} · {product.facts?.kind??product.category}</span><strong className="experiment-price">{Number(product.price_experiment).toLocaleString()}원</strong></div>
      <img className="experiment-product-image" src={product.image_url} alt={`${product.name} 원본 상품 이미지`} loading="eager" onError={event=>{const image=event.currentTarget;if(image.getAttribute("src")!=="/products/category-illustration.svg")image.src="/products/category-illustration.svg";image.alt="원본 상품 이미지를 불러올 수 없습니다";}} />
      <h3>{product.name}</h3><ul className="experiment-product-summary">{productSummaryKo(product.id).map((fact,factIndex)=><li key={factIndex}>{fact}</li>)}</ul>
      <button type="button" className="button secondary training-detail-button" onClick={()=>openProductDetail(product.id)}>원본 상품 정보 보기</button>
    </div>;
  }
  if(!role)return <section className="panel"><p>참가자 역할을 확인하고 있습니다.</p>{error&&<p role="alert">{error}</p>}</section>;
  if(finished)return <main className="experiment-shell training-shell"><section className="panel" style={{maxWidth:820,margin:"24px auto"}}><p className="eyebrow">역할별 연습 완료</p><h1 className="title">연구를 시작할 수 있습니다</h1><p className="body">본실험에서는 과업 진행 방식과 최종 결정 주체의 다른 조합도 나타날 수 있습니다. 심리척도는 종이 설문으로 응답합니다.</p><a className="button" href={role==="giver"?"/experiment/giver":"/experiment/recipient"}>본실험 시작</a></section></main>;
  return <main className={`experiment-shell training-shell${showExposureClock?" has-exposure-clock":""}`}>
    <header className="experiment-header training-header">
      <div className="training-header-main">
        <div><div className="experiment-brand"><strong>선물 추천 Agent</strong><span>연습 {scenario+1} / 2</span></div><h1 className="title">추천 과정 알아보기</h1></div>
        <div className="training-header-task"><b>{role==="recipient"?"선물 받는 사람 · 관찰 연습":"선물 주는 사람 · 조작 연습"}</b><span>현재 단계 {currentStageIndex+1} / 4 · {scenario===1&&currentStage==="criteria"?"정보 확인":practiceStages[currentStageIndex]?.label}</span><span>{currentTask}</span></div>
        <div className="training-header-time" role="status" aria-label="현재 연습 단계 최소 확인시간">
          {showExposureClock?<><b>확인시간 {Math.floor(Math.min(stageExposureMs,minimumPracticeExposureMs)/1000)} / {minimumPracticeExposureMs/1000}초</b><span>{!pageVisible?"화면을 벗어나 시간이 멈췄습니다.":exposureVerified?"최소 확인시간 충족":remainingStageSeconds===0?"확인 중":`${remainingStageSeconds}초 남음`}</span><div className="training-header-progress" role="progressbar" aria-label="연습 확인시간 진행률" aria-valuemin={0} aria-valuemax={minimumPracticeExposureMs/1000} aria-valuenow={Math.min(minimumPracticeExposureMs/1000,Math.floor(stageExposureMs/1000))}><span style={{width:`${Math.min(100,stageExposureMs/minimumPracticeExposureMs*100)}%`}}/></div></>:<><b>{started?"선택·확인 단계":"연습 시작 전"}</b><span>{started?"표시된 행동을 확인해 주세요.":"연습을 시작하면 확인시간이 표시됩니다."}</span></>}
        </div>
      </div>
      <ol className="experiment-phase-step" aria-label="연습 진행 단계">{practiceStages.map((stage,index)=><li key={stage.id} className={index===currentStageIndex?"is-active":index<currentStageIndex?"is-complete":""} aria-current={index===currentStageIndex?"step":undefined}><span>{index+1}</span>{scenario===1&&stage.id==="criteria"?"정보 확인":stage.label}</li>)}</ol>
    </header>
    {practiceProfile&&<section className="training-context card" aria-label="연습용 선물 받는 사람 정보">
      <div className="training-context-person"><p className="eyebrow">연습용 선물 받는 사람 · 연구자가 정한 정보</p><h2>{practiceProfile.name} <span>{practiceProfile.age}세 · {practiceProfile.occupation} · {practiceProfile.gift_occasion}</span></h2><strong>고정 예산 {practiceProfile.gift_budget.toLocaleString()}원</strong></div>
      <div className="training-context-detail"><p className="body"><b>관심사</b> {practiceProfile.hobbies.join(" · ")}</p><p className="body">{practiceProfile.recent_interest} {practiceProfile.preference} {practiceProfile.dislike}</p><p className="body">{role==="recipient"?"당신은 선물을 받는 사람입니다. 선물 주는 사람과 Agent가 당신에게 줄 선물을 고르는 과정을 살펴보게 됩니다.":scenario===0?"기준을 입력하고 후보 구성·비교를 요청한 뒤 최종 선물을 직접 선택합니다.":"Agent가 제공된 정보를 바탕으로 후보 구성·비교·최종 선택을 진행합니다. 추가 정보를 입력하지 않습니다."}</p></div>
      <details className="training-context-note"><summary>연습용 자료 안내</summary><p>이 화면은 연구자가 구성한 연습용 시나리오입니다. 가격은 2024년 상품 기록을 연구용으로 고정 환산한 값이며 현재 판매가격이 아닙니다. 상품 상세를 열어 보는 시간도 현재 구간의 확인시간에 포함됩니다.</p></details>
    </section>}
    {error&&<p role="alert" className="experiment-error">{error}</p>}
    <div className="training-main-grid">
      <section className="training-workspace" aria-label="연습 대화와 입력">
      <section className="experiment-transcript" aria-label="연습용 대화 재생">
        <div className="training-transcript-heading"><p className="eyebrow">연습 대화</p><h2>추천 과정</h2></div>
        <div className="training-transcript-scroll" ref={transcriptScrollRef} onScroll={event=>{const pane=event.currentTarget;transcriptPinnedToBottom.current=pane.scrollHeight-pane.clientHeight-pane.scrollTop<90;}}>
        {!started?<div className="training-start"><h3>{scenario===0?"선물 주는 사람 요청과 직접 선택":"Agent 자동 진행과 Agent 최종 선택"}</h3><p className="body">{scenario===0?"선물 주는 사람의 입력, 상품 후보, 비교, 결정을 시간순으로 확인합니다.":"Agent가 제공된 인물 정보를 읽고 상품 후보를 제시한 뒤 비교하고 하나를 선택하는 과정을 확인합니다."}</p><button type="button" className="button" onClick={start}>{role==="recipient"?"관찰 시작":"연습 시작"}</button></div>:visibleSteps.map((step,index)=><article key={index} className={"experiment-message "+(step.actor==="agent"?"from-agent":"from-person")}>
          <p className="experiment-speaker">{step.actor==="agent"?"Agent":"선물 주는 사람"} · {step.kind==="dropdown"?"드롭다운 선택":step.segment==="decision"?"최종 결정":step.segment==="comparison"?"후보 비교":"대화"}</p>
          <div className="experiment-message-bubble"><p className="body">{role==="giver"&&scenario===0&&index===steps.length-1&&practiceSelected?`선물 주는 사람이 선택한 최종 선물: ${practiceProducts[practiceSelected-1].name}`:overrides[index]??step.text}</p></div>
          {step.kind==="dropdown"&&<div className="scripted-dropdown"><label>카테고리<select disabled value="전체"><option>전체</option></select></label><label>중요 기준<select disabled value={role==="giver"?selectedPriority:"실용성"}><option>{role==="giver"?selectedPriority:"실용성"}</option></select></label></div>}
        </article>)}
        </div>
      </section>
      {started&&role==="giver"&&next?.actor==="giver"&&<section className="experiment-composer experiment-task card"><p className="eyebrow">선물 주는 사람 입력</p>{next.kind==="dropdown"?<><label>상품 카테고리<select className="field" value="전체" disabled><option value="전체">전체</option></select></label><label>가장 중요한 기준<select className="field" value={selectedPriority} onChange={e=>setSelectedPriority(e.target.value)}><option value="실용성">실용성</option><option value="취향 적합성">취향 적합성</option><option value="감성적">감성적</option></select></label><button className="button" onClick={()=>{setOverrides(old=>({...old,[cursor+1]:`선택해서 입력하기 · 카테고리: 전체 · 중요 기준: ${selectedPriority}`}));setCursor(c=>c+1);}}>조건 적용</button></>:next.kind==="decision"?<><p className="body">{!exposureVerified?remainingStageSeconds>0?`후보 비교를 ${remainingStageSeconds}초 더 확인한 뒤 최종 선물을 선택할 수 있습니다.`:"확인시간을 검증하고 있습니다.":"최종 선물을 직접 선택해 주세요."}</p><div className="training-choice">{practiceProducts.map((product,i)=><button className="button secondary" key={product.id} disabled={!exposureVerified||!pageVisible} onClick={()=>void choosePracticeProduct(i,product.name)}>{i+1}번 · {product.name}</button>)}</div></>:<><label>대화 입력<input className="field" value={input} onChange={e=>setInput(e.target.value)} placeholder={next.text}/></label><button className="button" disabled={!input.trim()} onClick={send}>전송</button></>}</section>}
      {started&&cursor===steps.length-1&&<section className="experiment-task card training-check"><h2>방금 본 행동 확인</h2>{replaySegment&&<><p role="alert">해당 행동을 다시 살펴봐 주세요.</p><button className="button secondary" onClick={replay}>해당 구간 다시 보기</button></>}{!replaySegment&&<><p className="body">{questions[0]}</p><div className="training-choice"><label><input type="radio" name="comparison" checked={comparison==="giver"} onChange={()=>setComparison("giver")}/> 선물 주는 사람 요청</label><label><input type="radio" name="comparison" checked={comparison==="agent"} onChange={()=>setComparison("agent")}/> Agent 자동 진행</label></div><p className="body">{questions[1]}</p><div className="training-choice"><label><input type="radio" name="decision" checked={decision==="giver"} onChange={()=>setDecision("giver")}/> 선물 주는 사람</label><label><input type="radio" name="decision" checked={decision==="agent"} onChange={()=>setDecision("agent")}/> Agent</label></div><button className="button" disabled={!comparison||!decision||busy} onClick={()=>void check()}>{busy?"확인 중…":"답변 확인"}</button></>}</section>}
      </section>
      <aside className={`training-results${candidatesVisible?"":" is-empty"}`} aria-label="연습 상품과 비교 결과">
        <div className="training-results-header"><div><p className="eyebrow">연습용 상품 결과</p><h2>{resultTab==="comparison"?"후보 비교":resultTab==="decision"?"최종 선물":"후보 상품"}</h2></div><div className="training-results-tabs" role="tablist" aria-label="연습 결과 다시 보기">
          <button type="button" role="tab" aria-selected={resultTab==="candidates"} disabled={!candidatesVisible} onClick={()=>setResultTab("candidates")}>후보 3개</button>
          <button type="button" role="tab" aria-selected={resultTab==="comparison"} disabled={!comparisonVisible} onClick={()=>setResultTab("comparison")}>비교표</button>
          <button type="button" role="tab" aria-selected={resultTab==="decision"} disabled={!decisionVisible} onClick={()=>setResultTab("decision")}>선택 결과</button>
        </div></div>
        <div className="training-results-body" role="tabpanel">
          {resultTab==="candidates"&&(candidatesVisible?<div className="experiment-card-list">{practiceProducts.map((product,index)=>productCard(product,index))}</div>:<p className="body training-results-empty">후보 상품이 제시되면 이곳에서 함께 볼 수 있습니다.</p>)}
          {resultTab==="comparison"&&(comparisonVisible?<div className="experiment-table-wrap"><table className="experiment-table"><thead><tr><th>비교 항목</th>{practiceComparisonRows.map(row=><th key={row.label}>{row.label} · {row.product_name}</th>)}</tr></thead><tbody>{practiceComparisonFields.map(([field,label])=><tr key={field}><th>{label}</th>{practiceComparisonRows.map(row=><td key={row.label}>{field==="price"?Number(row.price).toLocaleString()+"원":String(row[field as keyof typeof row]??"정보 없음")}</td>)}</tr>)}</tbody></table></div>:<p className="body training-results-empty">후보 비교가 시작되면 이곳에 표시됩니다.</p>)}
          {resultTab==="decision"&&(decisionVisible&&finalProduct?<div className="training-final-result"><p className="body"><b>{scenario===0?"선물 주는 사람이 선택한 최종 선물":"Agent가 선택한 최종 선물"}</b></p>{productCard(finalProduct,practiceProducts.findIndex(product=>product.id===finalProduct.id),true)}</div>:<p className="body training-results-empty">최종 결정 후 선택 결과가 표시됩니다.</p>)}
        </div>
      </aside>
    </div>
    {detailProduct&&<div className="training-detail-overlay" role="presentation" onClick={()=>setDetailProductId(null)}><section className="training-detail-panel" role="dialog" aria-modal="true" aria-label={`${detailProduct.name} 원본 상품 정보`} onClick={event=>event.stopPropagation()}><div className="training-detail-header"><h2>{detailProduct.name}</h2><button type="button" className="button secondary" onClick={()=>setDetailProductId(null)}>닫기</button></div><img src={detailProduct.image_url} alt={`${detailProduct.name} 원본 상품 이미지`} onError={event=>{if(event.currentTarget.getAttribute("src")!=="/products/category-illustration.svg")event.currentTarget.src="/products/category-illustration.svg";}}/><p className="body"><b>원본명</b> {detailProduct.original}</p><p className="body"><b>연구용 고정 가격</b> {Number(detailProduct.price_experiment).toLocaleString()}원 · 원본 기록 ${Number(detailProduct.price_original).toFixed(2)} (USD, {detailProduct.source_timestamp_raw?.slice(0,10)??"2024-08"})</p><p className="body">{detailProduct.description}</p>{detailProduct.source_url?.startsWith("https://www.walmart.com/")&&<a href={detailProduct.source_url} target="_blank" rel="noopener noreferrer">CSV에 기록된 상품 링크 (현재 내용은 다를 수 있음)</a>}</section></div>}
  </main>;
}
