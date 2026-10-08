"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPERIMENT } from "@/config/experiment";
import { normalizeCriteria, participantCriterionText, RECOMMENDATION_CRITERIA, toggleCriterion } from "@/lib/experiment/criteria";

type Role = "giver" | "recipient";
type Phase = "criteria" | "candidates" | "comparison" | "decision" | "awaiting_survey" | "completed";
type Row = any;

const phaseTitles: Record<string,string> = {
  criteria: "추천 기준 확인", candidates: "선물 후보 살펴보기", comparison: "후보 비교",
  decision: "최종 선물 선택", awaiting_survey: "종이 설문 안내", completed: "참여 완료",
};
const progressStages = [
  {id:"criteria",label:"기준 입력"},
  {id:"candidates",label:"후보 확인"},
  {id:"comparison",label:"후보 비교"},
  {id:"decision",label:"최종 결정"},
] as const;

function productFor(candidate: Row) {
  return candidate?.product_snapshot && Object.keys(candidate.product_snapshot).length
    ? candidate.product_snapshot : candidate?.gift_candidates ?? {};
}
function labelFor(order: number) { return String.fromCharCode(64 + order); }
function participantFacingText(value:string){
  return participantCriterionText(value).replace(/(증여자|수혜자)(은|는|이|가|을|를|의|에게|와|과)/g,(_match,role:string,particle:string)=>{
    const name=role==="증여자"?"선물 주는 사람":"선물 받는 사람";
    const replaced:Record<string,string>={은:"은",는:"은",이:"이",가:"이",을:"을",를:"을",의:"의",에게:"에게",와:"과",과:"과"};
    return name+replaced[particle];
  }).replaceAll("증여자","선물 주는 사람").replaceAll("수혜자","선물 받는 사람");
}
function waitForImageDecode(image:HTMLImageElement) {
  return new Promise<void>((resolve,reject)=>{
    const fallback=new URL("/products/category-illustration.svg",window.location.origin).href;
    const timeout=window.setTimeout(()=>finish(new Error("상품 이미지와 대체 이미지를 표시하지 못했습니다.")),10000);
    const cleanup=()=>{window.clearTimeout(timeout);image.removeEventListener("load",check);image.removeEventListener("error",onError);};
    const finish=(error?:Error)=>{cleanup();error?reject(error):resolve();};
    const check=()=>{
      if(!image.complete)return;
      if(image.naturalWidth>0){
        if(image.decode)image.decode().then(()=>finish(),()=>image.naturalWidth>0?finish():undefined);
        else finish();
      }else if(image.dataset.imageFailed==="true"||image.currentSrc===fallback){
        finish(new Error("상품 이미지와 승인된 대체 이미지를 표시하지 못했습니다."));
      }
    };
    const onError=()=>window.setTimeout(check,0);
    image.addEventListener("load",check);image.addEventListener("error",onError);check();
  });
}

function CandidateCard({ candidate, details = false, selected = false, onSelect, onToggle }: {
  candidate: Row; details?: boolean; selected?: boolean; onSelect?: () => void; onToggle?: () => void;
}) {
  const p = productFor(candidate);
  const specs = p.specifications ?? {};
  const rows = (Array.isArray(specs)?specs.map((item:Row)=>[String(item.name??"규격"),item.value] as [string,unknown]):Object.entries(specs)).filter(([key,value]) => key !== "configuration_label" && value !== null && value !== undefined && value !== "").slice(0,12);
  return <article className={"experiment-candidate" + (selected ? " is-selected" : "")}>
    <div className="experiment-candidate-summary"><span className="experiment-candidate-label">후보 {labelFor(candidate.display_order)} · {p.category ?? "상품"}</span><strong className="experiment-price">{Number(p.price ?? 0).toLocaleString()}원</strong></div>
    <div className="experiment-product-head">
      <img className="experiment-product-image" data-exposure-phase="candidates" src={p.image_url || "/products/category-illustration.svg"} alt="제품 종류를 나타내는 예시 이미지" loading="eager" onError={e => { const image=e.currentTarget;const fallback="/products/category-illustration.svg";if(image.getAttribute("src")!==fallback)image.src=fallback;else image.dataset.imageFailed="true"; }} />
      <div><h3>{p.product_name ?? "상품 정보"}</h3>{p.product_name_original&&<p className="eyebrow">원본명 · {p.product_name_original}</p>}{p.brand&&<p className="eyebrow">브랜드 · {p.brand}</p>}<p className="body">{p.description}</p><p className="eyebrow">2024년 8월 CSV 원본가 · {Number(p.price_original??0).toFixed(2)} {p.currency_original??"USD"}</p></div>
    </div>
    {p.fit_reason && <p className="experiment-fit"><b>추천 이유</b> · {p.fit_reason}</p>}
    {onToggle && <button type="button" className="button secondary" onClick={onToggle}>{details?"상세 접기":"상세 보기"}</button>}
    {details && <div className="experiment-facts"><p><b>가격 기준</b> · 실험용 고정 환산가</p>
      {specs.configuration_label && <p><b>구성</b> · {specs.configuration_label}</p>}
      {rows.map(([key,value]) => <p key={key}><b>{key}</b> · {Array.isArray(value) ? value.join(", ") : String(value)}</p>)}
      {Array.isArray(p.use_cases) && <p><b>사용 상황</b> · {p.use_cases.join(" · ")}</p>}
      {Array.isArray(p.strengths) && <p><b>장점</b> · {p.strengths.join(" · ")}</p>}
      {Array.isArray(p.limitations) && <p><b>살펴볼 점</b> · {p.limitations.join(" · ")}</p>}
      {p.care_requirements && <p><b>관리</b> · {p.care_requirements}</p>}
    </div>}
    {onSelect && <button type="button" className={selected ? "button" : "button secondary"} onClick={onSelect}>{selected ? "최종 후보로 선택됨" : "이 선물을 선택"}</button>}
  </article>;
}

function ComparisonTable({ rows }: { rows: Row[] }) {
  if (!rows?.length) return <p className="body">비교 정보를 준비하고 있습니다.</p>;
  const fields: [string,string][] = [["product_name","상품"],["price","가격"],["configuration","규격·구성"],["use_case","사용 상황"],["strengths","장점"],["limitations","살펴볼 점"],["care_requirements","관리 방식"]];
  return <div className="experiment-table-wrap"><table className="experiment-table"><thead><tr><th>비교 기준</th>{rows.map((row:Row)=><th key={row.label}>{row.label} · {row.product_name}</th>)}</tr></thead><tbody>{fields.map(([key,title])=><tr key={key}><th>{title}</th>{rows.map((row:Row)=><td key={row.label}>{key === "price" ? Number(row[key] ?? 0).toLocaleString()+"원" : row[key] ?? "정보 없음"}</td>)}</tr>)}</tbody></table></div>;
}

export function Experiment({ role }: { role: Role }) {
  const [participantId,setParticipantId] = useState("");
  const [tabId,setTabId] = useState("");
  const [data,setData] = useState<Row|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [answers,setAnswers] = useState<Record<string,string>>({});
  const [chatText,setChatText]=useState("");
  const [dropdownOpen,setDropdownOpen]=useState(false);
  const [selectedCategory,setSelectedCategory]=useState("");
  const [selectedPriorities,setSelectedPriorities]=useState<string[]>([]);
  const [selectedTags,setSelectedTags]=useState<string[]>([]);
  const [recipientStarted,setRecipientStarted]=useState(false);
  const [recipientCursor,setRecipientCursor]=useState(0);
  const [ready,setReady] = useState(false);
  const [visible,setVisible] = useState(true);
  const [exposureMs,setExposureMs] = useState(0);
  const [selectedId,setSelectedId] = useState("");
  const [detailsOpen,setDetailsOpen] = useState<Record<string,boolean>>({});
  const viewedCandidates = useRef(new Set<string>());
  const readyAttempt = useRef("");
  const advancing = useRef("");
  const sequenceRef = useRef(0);
  const previousActive = useRef<boolean|null>(null);
  const phaseKeyRef = useRef("");
  const questionAcks = useRef(new Set<string>());
  const tabChannel = useRef<BroadcastChannel|null>(null);
  const newestMessageRef = useRef<HTMLElement|null>(null);
  const lastMessageCount = useRef({trialId:"",count:0});
  const sendingChat = useRef(false);

  useEffect(() => {
    const id = sessionStorage.getItem("participantId") ?? "";
    if (!id) { window.location.assign("/start"); return; }
    setParticipantId(id);
    const savedTab = sessionStorage.getItem("gift-experiment-tab-v2");
    const stableTab = savedTab || crypto.randomUUID();
    sessionStorage.setItem("gift-experiment-tab-v2",stableTab);
    if (typeof BroadcastChannel === "undefined") { setTabId(stableTab); return; }
    const instanceId=crypto.randomUUID();
    const channel=new BroadcastChannel("gift-experiment-tab-v2:"+id);
    tabChannel.current=channel;
    let decided=false;
    channel.onmessage=(event:MessageEvent<Row>)=>{
      const message=event.data;
      if (message?.tabId===stableTab && message.instanceId!==instanceId && message.type==="claim") {
        channel.postMessage({type:"collision",tabId:stableTab,targetInstanceId:message.instanceId,instanceId});
      }
      if (message?.type==="collision" && message.targetInstanceId===instanceId && !decided) {
        decided=true;
        const replacement=crypto.randomUUID();
        sessionStorage.setItem("gift-experiment-tab-v2",replacement);
        setTabId(replacement);
        channel.postMessage({type:"claim",tabId:replacement,instanceId});
      }
    };
    channel.postMessage({type:"claim",tabId:stableTab,instanceId});
    const timeout=window.setTimeout(()=>{if(!decided){decided=true;setTabId(stableTab);}},180);
    return()=>{window.clearTimeout(timeout);channel.close();tabChannel.current=null;};
  },[]);

  const trial: Row|undefined = data?.activeTrial;
  const phase = (trial?.current_phase ?? "criteria") as Phase;
  const guided = trial?.execution_autonomy === "human_guided";
  const humanDecision = trial?.decision_authority === "human";
  const messages: Row[] = useMemo(() => [...(trial?.trial_messages ?? [])].sort((a:Row,b:Row) => new Date(a.created_at).getTime()-new Date(b.created_at).getTime()),[trial?.trial_messages]);
  const candidates: Row[] = useMemo(() => [...(trial?.trial_candidates ?? [])].sort((a:Row,b:Row)=>a.display_order-b.display_order),[trial?.trial_candidates]);
  const currentExposure = (trial?.trial_phase_exposures ?? []).find((x:Row)=>x.phase===phase);
  const searchState=data?.searchState;
  const catalogOptions=data?.catalogOptions??{categories:[],tags:[],eligibleCount:0,items:[]};
  const filteredCatalogCount=(catalogOptions.items??[]).filter((item:Row)=>(!searchState?.selected_category||item.category===searchState.selected_category)&&(!(searchState?.preference_tags??[]).length||(searchState.preference_tags as string[]).some(tag=>(item.search_tags_ko??[]).includes(tag)))).length;
  const catalogReady=filteredCatalogCount>=3;
  const criteriaFilled=Boolean(searchState?.query_text||searchState?.selected_category||searchState?.preference_tags?.length||searchState?.selection_priorities?.length);
  const shownMessages=role==="recipient"?messages.slice(0,recipientCursor):messages;
  useEffect(()=>{
    if(!trial)return;
    const count=shownMessages.length;
    const previous=lastMessageCount.current;
    lastMessageCount.current={trialId:trial.id,count};
    if(previous.trialId===trial.id&&previous.count>0&&count>previous.count&&visible){
      requestAnimationFrame(()=>newestMessageRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));
    }
  },[trial?.id,shownMessages.length,visible]);
  useEffect(()=>{setSelectedCategory(searchState?.selected_category??"");setSelectedPriorities(normalizeCriteria(searchState?.selection_priorities??[]));setSelectedTags(searchState?.preference_tags??[]);},[trial?.id,searchState?.state_version]);

  useEffect(()=>{
    if(!trial||role!=="recipient")return;
    const key="recipient-playback:"+trial.id;
    const saved=Number(sessionStorage.getItem(key)??"0");
    setRecipientStarted(saved>0);setRecipientCursor(Math.min(messages.length,saved));
  },[trial?.id,role]);
  useEffect(()=>{
    if(role!=="recipient"||!trial||!recipientStarted||!visible||recipientCursor>=messages.length)return;
    const timer=window.setTimeout(()=>{
      const next=recipientCursor+1;
      sessionStorage.setItem("recipient-playback:"+trial.id,String(next));
      setRecipientCursor(next);
    },1300);
    return()=>window.clearTimeout(timer);
  },[role,trial?.id,recipientStarted,visible,recipientCursor,messages.length]);

  const load = useCallback(async () => {
    if (!participantId) return;
    const response = await fetch("/api/experiment/current?participantId="+encodeURIComponent(participantId),{cache:"no-store"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "연구 정보를 불러오지 못했습니다.");
    setData(result);
    const activeTrial = result.activeTrial;
    if (activeTrial?.guided_responses) setAnswers(Object.fromEntries(activeTrial.guided_responses.map((x:Row)=>[x.question_id,x.answer_value])));
    const finalSelection = activeTrial?.final_selections?.[0]?.selected_candidate_id;
    if (finalSelection) setSelectedId(finalSelection);
  },[participantId]);

  useEffect(() => { if (participantId) load().catch(e=>setError(e.message)); },[participantId,load]);

  useEffect(()=>{
    if(!trial||!participantId)return;
    const navigation=performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming|undefined;
    if(navigation?.type==="reload")log("page_refreshed").catch(()=>{});
    const hidden=()=>log(document.visibilityState==="hidden"?"page_hidden":"page_visible").catch(()=>{});
    const offline=()=>log("connection_lost").catch(()=>{});
    const online=()=>{void (async()=>{await flushPendingEvents();await log("connection_restored");})().catch(()=>{});};
    document.addEventListener("visibilitychange",hidden);window.addEventListener("offline",offline);window.addEventListener("online",online);
    return()=>{document.removeEventListener("visibilitychange",hidden);window.removeEventListener("offline",offline);window.removeEventListener("online",online);};
  },[trial?.id,participantId]);

  async function phaseAction(action:string,extra:Row={}) {
    const response = await fetch("/api/experiment/phase",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,participantId,trialId:trial?.id,tabId,...extra})});
    const result = await response.json();
    if (!response.ok) {
      void log("error_occurred",undefined,undefined,{source:"experiment_phase",status:response.status,code:result.code??"unknown"}).catch(()=>{});
      throw Object.assign(new Error(result.error ?? "연구 단계를 저장하지 못했습니다."),{status:response.status});
    }
    if(result.accepted===false)void log("duplicate_rejected",undefined,action,{reason:result.reason??"duplicate_or_stale"}).catch(()=>{});
    return result;
  }

  async function sendEventLog(entry:Row) {
    if (!participantId || !trial) return;
    const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"event",participantId,trialId:trial.id,...entry})});
    if (!response.ok) { const result=await response.json(); throw new Error(result.error ?? "행동 기록을 저장하지 못했습니다."); }
  }

  function pendingEventKey() { return trial?`pending-events:${trial.id}`:"pending-events"; }
  function queueEvent(entry:Row) {
    if(typeof window==="undefined")return;
    const key=pendingEventKey();
    try { const current=JSON.parse(sessionStorage.getItem(key)??"[]");sessionStorage.setItem(key,JSON.stringify([...current,entry])); } catch {}
  }
  async function log(eventType:string,eventValue?:string,eventTarget?:string,payload:Row={}) {
    const entry={eventType,eventValue,eventTarget,payload,clientTimestamp:new Date().toISOString(),idempotencyKey:crypto.randomUUID()};
    if(!navigator.onLine){queueEvent(entry);return;}
    try { await sendEventLog(entry); }
    catch(error) { if(error instanceof TypeError||!navigator.onLine){queueEvent(entry);return;}throw error; }
  }
  async function flushPendingEvents() {
    if(typeof window==="undefined"||!trial)return;
    const key=pendingEventKey();let pending:Row[]=[];
    try { pending=JSON.parse(sessionStorage.getItem(key)??"[]"); } catch { sessionStorage.removeItem(key);return; }
    while(pending.length){
      try { await sendEventLog(pending[0]); } catch { return; }
      pending=pending.slice(1);
      if(pending.length)sessionStorage.setItem(key,JSON.stringify(pending));else sessionStorage.removeItem(key);
    }
  }
  useEffect(()=>{if(trial&&navigator.onLine)void flushPendingEvents();},[trial?.id,participantId]);

  // A message is acknowledged only after React rendered it; product images are allowed to decode first.
  useEffect(() => {
    if (!trial || !tabId || !participantId || !visible || !["criteria","candidates","comparison"].includes(phase)) return;
    if(role==="recipient"&&(!recipientStarted||recipientCursor<messages.length))return;
    const key = trial.id+":"+phase;
    if (readyAttempt.current === key) return;
    let cancelled=false;
    readyAttempt.current=key;
    (async()=>{
      try {
        const phaseMessages=shownMessages.filter(m=>m.phase===phase);
        const images=Array.from(document.querySelectorAll<HTMLImageElement>("img[data-exposure-phase="+JSON.stringify(phase)+"]"));
        await Promise.all(images.map(waitForImageDecode));
        for (const message of phaseMessages) {
          if (cancelled) return;
          if (!message.rendered_at) await phaseAction("message_rendered",{messageId:message.id});
        }
        if (cancelled || document.visibilityState !== "visible" || !document.hasFocus()) return;
        const result=await phaseAction("ready",{phase});
        if (cancelled) return;
        setExposureMs(Number(result.accumulated_ms??currentExposure?.accumulated_ms??0));
        setReady(true);
        setError("");
      } catch(e) {
        readyAttempt.current="";
        if (!cancelled) {
          const err=e as Error & {status?:number};
          if (err.status===409) { setError(err.message); load().catch(()=>{}); }
          else setError(err.message);
        }
      }
    })();
    return()=>{cancelled=true;if(readyAttempt.current===key)readyAttempt.current="";};
  },[trial?.id,phase,tabId,participantId,visible,messages,recipientStarted,recipientCursor,role,currentExposure?.accumulated_ms,load]);

  useEffect(() => {
    if (!trial || !tabId || !participantId || !visible || !["decision","awaiting_survey"].includes(phase)) return;
    if(role==="recipient"&&(!recipientStarted||recipientCursor<messages.length))return;
    const phasesToAck=phase==="awaiting_survey"?["decision","awaiting_survey"]:["decision"];
    let cancelled=false;
    (async()=>{
      try {
        for (const message of shownMessages.filter(item=>phasesToAck.includes(item.phase)&&!item.rendered_at)) {
          if (cancelled) return;
          await phaseAction("message_rendered",{messageId:message.id});
        }
      } catch(e) { if(!cancelled)setError((e as Error).message); }
    })();
    return()=>{cancelled=true;};
  },[trial?.id,phase,tabId,participantId,visible,messages,recipientStarted,recipientCursor,role]);

  useEffect(() => {
    const onState=()=>setVisible(document.visibilityState==="visible" && document.hasFocus() && navigator.onLine);
    onState();
    document.addEventListener("visibilitychange",onState);
    window.addEventListener("focus",onState); window.addEventListener("blur",onState);
    window.addEventListener("online",onState); window.addEventListener("offline",onState);
    return()=>{document.removeEventListener("visibilitychange",onState);window.removeEventListener("focus",onState);window.removeEventListener("blur",onState);window.removeEventListener("online",onState);window.removeEventListener("offline",onState);};
  },[]);

  useEffect(() => {
    if (!ready || !trial || !tabId || !participantId || !["criteria","candidates","comparison"].includes(phase)) return;
    const phaseKey=trial.id+":"+phase;
    if (phaseKeyRef.current!==phaseKey) {
      phaseKeyRef.current=phaseKey;
      sequenceRef.current=Number(sessionStorage.getItem("exposure-seq:"+phaseKey)??"0");
      previousActive.current=null;
    }
    let inFlight=false;
    const isActiveNow=()=>document.visibilityState==="visible"&&document.hasFocus()&&navigator.onLine;
    const heartbeat=async(active=isActiveNow())=>{
      if (inFlight) return;
      inFlight=true;
      sequenceRef.current+=1;
      sessionStorage.setItem("exposure-seq:"+phaseKey,String(sequenceRef.current));
      try {
        const result=await phaseAction("heartbeat",{phase,sequence:sequenceRef.current,active,wasActive:previousActive.current,reason:!navigator.onLine?"offline":document.visibilityState!=="visible"?"hidden":"blurred"});
        if (result.accepted!==false) setExposureMs(Number(result.accumulated_ms??0));
        previousActive.current=active;
        setError("");
      } catch(e) {
        const err=e as Error & {status?:number};
        if (err.status===409) { setReady(false); setError(err.message); load().catch(()=>{}); }
      } finally { inFlight=false; }
    };
    const syncState=()=>{const active=isActiveNow();setVisible(active);void heartbeat(active);};
    const timer=window.setInterval(()=>{void heartbeat();},EXPERIMENT.heartbeatIntervalMs);
    document.addEventListener("visibilitychange",syncState);
    window.addEventListener("focus",syncState);window.addEventListener("blur",syncState);
    window.addEventListener("online",syncState);window.addEventListener("offline",syncState);
    syncState();
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",syncState);window.removeEventListener("focus",syncState);window.removeEventListener("blur",syncState);window.removeEventListener("online",syncState);window.removeEventListener("offline",syncState);};
  },[ready,trial?.id,phase,tabId,participantId,load]);

  useEffect(() => {
    setReady(false); readyAttempt.current=""; setExposureMs(Number(currentExposure?.accumulated_ms??0));
  },[trial?.id,phase]);

  useEffect(() => {
    if (!trial || phase!=="candidates" || messages.some((message:Row)=>message.message_type==="product_cards") || !tabId) return;
    setBusy(true);
    fetch("/api/experiment/phase",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"retry_generation",participantId,trialId:trial.id,tabId})})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error??"후보를 준비하지 못했습니다.");await load();})
      .catch(e=>setError((e as Error).message)).finally(()=>setBusy(false));
  },[trial?.id,phase,role,messages,participantId,tabId,load]);

  useEffect(() => {
    if (!trial || !ready || exposureMs<EXPERIMENT.minimumPhaseExposureMs || busy || !visible) return;
    const autonomous=role==="recipient" || phase==="comparison" || !guided;
    if (!autonomous || (role==="giver"&&phase==="criteria"&&(!criteriaFilled||!catalogReady))) return;
    const key=trial.id+":"+phase;
    if (advancing.current===key) return;
    advancing.current=key;
    setBusy(true);
    phaseAction("advance",{requested:false}).then(()=>load()).catch(e=>{advancing.current="";setError((e as Error).message);}).finally(()=>setBusy(false));
  },[trial?.id,phase,ready,exposureMs,busy,visible,role,guided,humanDecision,criteriaFilled,catalogReady,load]);

  async function saveAnswer(questionId:string,answer:string) {
    setError("");
    const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"answer",participantId,trialId:trial.id,questionId,answer})});
    const result=await response.json();
    if (!response.ok) { setError(result.error??"응답을 저장하지 못했습니다."); return; }
    setAnswers(previous=>({...previous,[questionId]:answer}));
    await load();
  }

  async function advance(requested:boolean) {
    setBusy(true); setError("");
    try {
      await phaseAction("advance",{requested});
      advancing.current=trial.id+":"+phase;
      await load();
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function sendChat(inputMode:"chat"|"dropdown",requestIntent:"criteria_update"|"search_request"|"compare_request"="criteria_update"){
    if(role!=="giver"||!trial||sendingChat.current)return;
    sendingChat.current=true;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/experiment/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,trialId:trial.id,tabId,inputMode,text:inputMode==="chat"?chatText:"",selectedCategory:selectedCategory||null,selectedPriorities,preferenceTags:selectedTags,requestIntent,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"대화를 저장하지 못했습니다.");
      if(inputMode==="chat")setChatText("");
      await load();
      if(result.finalCandidateId){
        const pick=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"select",participantId,trialId:trial.id,candidateId:result.finalCandidateId,eventTarget:"chat"})});
        const resultPick=await pick.json();if(!pick.ok)throw new Error(resultPick.error??"선택을 저장하지 못했습니다.");
        await load();
      }else if(result.advanceRequested){await phaseAction("advance",{requested:true});await load();}
    }catch(e){setError((e as Error).message);await load().catch(()=>{});}finally{sendingChat.current=false;setBusy(false);}
  }

  function togglePriority(priority:string){
    setSelectedPriorities(current=>toggleCriterion(current,priority));
  }

  function startObservation(){
    if(!trial)return;
    sessionStorage.setItem("recipient-playback:"+trial.id,"1");setRecipientCursor(1);setRecipientStarted(true);
    void log("observation_started",undefined,undefined,{stimulusId:trial.stimulus_id,stimulusVersion:trial.stimulus_version}).catch(e=>setError((e as Error).message));
  }

  async function withdraw(){
    if(!window.confirm("연구 참여를 중단하시겠습니까?"))return;
    setBusy(true);
    try{const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"withdraw",participantId,trialId:trial?.id})});const result=await response.json();if(!response.ok)throw new Error(result.error??"중단을 저장하지 못했습니다.");window.location.assign("/complete");}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  async function choose(candidate:Row) {
    const changed=Boolean(selectedId&&selectedId!==candidate.gift_candidate_id);
    setSelectedId(candidate.gift_candidate_id);
    try { await log(changed?"human_candidate_changed":"human_candidate_selected",candidate.gift_candidate_id,labelFor(candidate.display_order),{phase:"decision"}); }
    catch(e) { setError((e as Error).message); }
  }

  async function toggleCandidate(candidate:Row) {
    const id=candidate.gift_candidate_id;
    const isOpen=detailsOpen[id]??false;
    setDetailsOpen(previous=>({...previous,[id]:!isOpen}));
    try {
      if(isOpen)await log("candidate_closed",id,labelFor(candidate.display_order));
      else {
        const prior=viewedCandidates.current.has(id);
        await log(prior?"candidate_revisited":"candidate_opened",id,labelFor(candidate.display_order));
        await log("candidate_detail_viewed",id,labelFor(candidate.display_order));
        viewedCandidates.current.add(id);
      }
    } catch(e) { setError((e as Error).message); }
  }

  async function finalizeChoice() {
    if (!selectedId) return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"select",participantId,trialId:trial.id,candidateId:selectedId})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"선택을 저장하지 못했습니다.");
      await load();
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmPaperSurvey() {
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"confirm_survey",participantId,trialId:trial.id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"종이 설문 확인을 저장하지 못했습니다.");
      await load();
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (error && !data) return <section className="panel"><h1 className="title">연구 정보를 불러오지 못했습니다</h1><p role="alert">{error}</p><button className="button" onClick={()=>load().catch(e=>setError(e.message))}>다시 불러오기</button></section>;
  if (!data) return <section className="panel">연구 정보를 불러오는 중…</section>;
  if (!trial) return <section className="panel"><p className="eyebrow">연구 완료</p><h1 className="title">참여해 주셔서 감사합니다</h1><p className="body">모든 단계가 저장되었습니다.</p><a className="button" href="/complete">완료</a></section>;

  const profile=trial.recipient_profiles ?? {};
  const exposurePercent=Math.min(100,Math.round(exposureMs/EXPERIMENT.minimumPhaseExposureMs*100));
  const allGuidedAnswers=EXPERIMENT.questions.every(q=>Boolean(answers[q.id]));
  const canRequest=ready && visible && exposureMs>=EXPERIMENT.minimumPhaseExposureMs && !busy;
  const taskOwner=guided?"선물 주는 사람":"AI";
  const decisionOwner=humanDecision?"선물 주는 사람":"AI";
  const stageIndex=progressStages.findIndex(stage=>stage.id===phase);

  return <main className={`experiment-shell role-${role} phase-${phase}`}>
    <header className="experiment-header">
      <div className="experiment-brand"><span className="experiment-brand-mark" aria-hidden="true">✦</span><span>AI 선물 에이전트</span><span className="experiment-brand-role">{role==="giver"?"선물 주는 사람":"선물 받는 사람"}</span></div>
      <p className="experiment-trial-counter">선물 선택 {trial.trial_number} / 4 · {role==="giver"?"직접 참여":"과정 관찰"}</p>
      <h1 className="title">{phaseTitles[phase] ?? "선물 추천 연구"}</h1>
      <div className="experiment-roles"><span>후보 구성·비교 · <b>{guided?"선물 주는 사람이 요청":"AI가 자동 진행"}</b></span><span>최종 선택 · <b>{decisionOwner}</b></span></div>
      <ol className="experiment-phase-step" aria-label="선물 선택 진행 단계">{progressStages.map((stage,index)=><li key={stage.id} className={index===stageIndex?"is-active":index<stageIndex||stageIndex<0?"is-complete":""} aria-current={index===stageIndex?"step":undefined}><span>{index+1}</span>{stage.label}</li>)}</ol>
    </header>

    {error && <p className="experiment-error" role="alert">{error}</p>}

    <div className="experiment-main-grid">
    <aside className="experiment-context">
    <section className="experiment-profile card" aria-label="선물 받는 사람 정보">
      <p className="eyebrow">선물 받는 사람 정보</p>
      <div className="experiment-profile-meta"><div><h2>{profile.name ?? profile.profile_code}</h2><p className="body">{profile.age}세 · {profile.occupation} · {profile.gift_occasion}</p></div><span className="experiment-budget">예산 {Number(profile.gift_budget ?? 0).toLocaleString()}원</span></div>
      <p className="body"><b>관심사</b> · {(profile.hobbies ?? []).join(" · ")}</p>
      <div className="experiment-profile-details"><p className="body">{profile.recent_interest}</p><p className="body">{profile.preference}</p><p className="body">{profile.dislike}</p></div>
    </section>

    {role==="giver"&&data?.aiConfigured===false&&<p className="experiment-error" role="status">AI 대화 설정이 완료되지 않았습니다. 연구자가 Vercel Production의 ANTHROPIC_API_KEY를 확인하고 새 배포를 해야 합니다.</p>}
    {role==="giver"&&phase==="criteria"&&!catalogReady&&<p className="experiment-error" role="status">현재 기준과 예산에 맞는 검토된 상품이 {filteredCatalogCount}개입니다. 후보 구성에는 3개가 필요합니다. {Number(catalogOptions.eligibleCount??0)>=3?"기준을 넓히거나 연구자에게 상품 준비를 요청해 주세요.":"연구자에게 상품 준비를 요청해 주세요."}</p>}
    </aside>
    <div className="experiment-workspace">

    {role==="recipient"&&!recipientStarted&&<section className="experiment-task card"><h2>관찰을 시작합니다</h2><p className="body">{data?.stimulusSource==="recorded"?"이 화면은 기록된 대화를 검토해 만든 관찰 자극입니다.":"이 화면은 연구자가 구성하고 검토한 시나리오입니다."} 화면의 선물 주는 사람 입력은 당신의 행동으로 기록되지 않습니다.</p><button className="button" onClick={startObservation}>관찰 시작</button></section>}

    <section className="experiment-transcript" aria-label="추천 대화 기록">
      <div className="experiment-section-heading"><div><p className="eyebrow">저장되는 대화</p><h2>추천 과정</h2></div><span className="experiment-phase-pill">{phaseTitles[phase]}</span></div>
      {shownMessages.map((message:Row,index:number)=>{
        const agent=message.actor_type==="agent"||message.actor_type==="system";
        const speaker=message.simulated_actor_event||message.actor_type==="simulated_giver"?`선물 주는 사람(${data?.stimulusSource==="recorded"?"기록 재생":"연구 시나리오"})`:agent?"AI":"선물 주는 사람";
        return <article key={message.id} ref={index===shownMessages.length-1?newestMessageRef:null} className={"experiment-message "+(agent?"from-agent":"from-person")}>
          <div className="experiment-message-bubble">
          <p className="experiment-speaker">{speaker}{message.simulated_actor_event&&<span> · 시나리오 재생</span>}</p>
          {message.content && <p className="body">{participantFacingText(message.content)}</p>}
          {role==="recipient"&&message.payload?.inputMode==="dropdown"&&<div className="scripted-dropdown" aria-label="선물 주는 사람이 선택한 드롭다운 기준"><label>선물 주는 사람이 선택한 상품 카테고리<select disabled value={message.payload.selectedCategory??""}><option>{message.payload.selectedCategory??""}</option></select></label><label>선물 주는 사람이 선택한 중요 기준<select disabled value={participantCriterionText(message.payload.selectedPriority??"")}><option>{participantCriterionText(message.payload.selectedPriority??"")}</option></select></label></div>}
          </div>
          {message.message_type==="product_cards" && <div className="experiment-card-list">{candidates.map((candidate:Row)=><div key={candidate.id}><CandidateCard candidate={candidate} details={detailsOpen[candidate.gift_candidate_id]??false} onToggle={()=>void toggleCandidate(candidate)}/></div>)}</div>}
          {message.message_type==="comparison" && <div data-exposure-phase="comparison"><ComparisonTable rows={message.payload?.rows ?? []}/></div>}
        </article>;
      })}
      {!messages.length && <p className="body">추천 과정의 대화를 준비하고 있습니다.</p>}
    </section>



    {(["criteria","candidates","comparison"].includes(phase)) && <section className="experiment-clock card" aria-live="polite">
      <div className="experiment-clock-line"><b>이 화면을 확인한 시간</b><span>{Math.floor(exposureMs/1000)} / {Math.ceil(EXPERIMENT.minimumPhaseExposureMs/1000)}초</span></div>
      <div className="experiment-progress"><span style={{width:String(exposurePercent)+"%"}}/></div>
      <p className="eyebrow">{!visible?"화면이 보일 때 시간이 다시 누적됩니다.":!ready?"화면을 준비하고 있습니다.":exposureMs<EXPERIMENT.minimumPhaseExposureMs?"내용을 확인해 주세요.":"최소 확인 시간이 충족되었습니다."}</p>
    </section>}

    {phase==="criteria" && role==="giver" && guided && <section className="experiment-task card"><p className="eyebrow">선물 주는 사람이 과업 요청</p><h2>기준을 입력한 뒤 후보 구성을 요청해 주세요</h2><button className="button" disabled={!canRequest||!criteriaFilled||!catalogReady} onClick={()=>void advance(true)}>{busy?"후보를 준비하고 있습니다…":"이 기준으로 후보를 찾아주세요"}</button>{!criteriaFilled&&<p className="eyebrow">대화에서 기준을 전송하거나 선택 메뉴에서 중요 기준을 적용해 주세요.</p>}</section>}

    {phase==="criteria" && role==="giver" && !guided && <section className="experiment-task card"><p className="eyebrow">공통 기준 입력</p><h2>대화 또는 선택 메뉴로 기준을 알려주세요</h2><p className="body">기준을 입력하고 최소 노출시간이 지나면 AI가 후보 구성과 비교를 이어갑니다.</p>{!criteriaFilled&&<p className="eyebrow">아직 기준이 입력되지 않았습니다.</p>}</section>}
    {phase==="criteria" && role==="recipient" && <section className="experiment-task card"><p className="eyebrow">관찰 안내</p><h2>선물 주는 사람과 AI가 기준을 정하는 과정을 확인해 주세요</h2><p className="body">이 화면은 정해진 연구 시나리오를 보여 줍니다. 선물 주는 사람의 대화나 최종 결정은 실제 입력으로 기록되지 않습니다.</p></section>}

    {phase==="candidates" && role==="giver" && guided && <section className="experiment-task card"><p className="eyebrow">다음 과업</p><h2>후보를 확인한 뒤 비교를 요청해 주세요</h2><p className="body">각 후보의 규격, 추천 이유, 장점과 살펴볼 점을 읽어 주세요.</p><button className="button" disabled={!canRequest||candidates.length!==3} onClick={()=>void advance(true)}>{busy?"비교를 준비하고 있습니다…":"세 후보의 장단점을 비교해주세요"}</button></section>}
    {phase==="candidates" && role==="giver" && !guided && <section className="experiment-task card"><p className="eyebrow">AI가 진행합니다</p><h2>세 후보의 정보를 확인해 주세요</h2><p className="body">최소 확인 시간이 지나면 AI가 같은 기준으로 세 후보를 비교합니다.</p></section>}
    {phase==="candidates" && role==="recipient" && <section className="experiment-task card"><p className="eyebrow">후보 관찰</p><h2>세 선물 후보와 구성을 확인해 주세요</h2></section>}

    {phase==="comparison" && <section className="experiment-task card"><p className="eyebrow">같은 기준으로 비교</p><h2>세 후보의 차이를 살펴봐 주세요</h2><p className="body">가격, 규격, 사용 상황, 장점, 살펴볼 점, 관리 방식을 나란히 확인합니다.</p>{role==="recipient"&&<p className="body">비교와 최종 선택은 연구 시나리오에 따라 진행됩니다.</p>}</section>}

    {phase==="decision" && role==="giver" && humanDecision && <section className="experiment-task card"><p className="eyebrow">선물 주는 사람의 최종 선택</p><h2>선물 받는 사람에게 줄 선물 하나를 골라주세요</h2><div className="experiment-card-list">{candidates.map((candidate:Row)=><CandidateCard key={candidate.id} candidate={candidate} details={detailsOpen[candidate.gift_candidate_id]??false} selected={selectedId===candidate.gift_candidate_id} onSelect={()=>void choose(candidate)} onToggle={()=>void toggleCandidate(candidate)}/>)}</div><button className="button" disabled={!selectedId||busy} onClick={()=>void finalizeChoice()}>{busy?"저장 중…":"최종 선물 확정"}</button></section>}
    {phase==="decision" && role==="giver" && !humanDecision && <section className="experiment-task card"><p className="eyebrow">AI의 최종 선택</p><h2>AI가 비교 기준에 따라 선물을 선택합니다</h2><p className="body">최종 선택과 근거는 대화 기록에 저장됩니다.</p></section>}
    {phase==="decision" && role==="recipient" && <section className="experiment-task card"><p className="eyebrow">최종 선택 관찰</p><h2>연구 시나리오의 선택 결과를 확인해 주세요</h2></section>}

    {phase==="awaiting_survey" && (role!=="recipient"||recipientCursor>=messages.length) && <section className="experiment-task card"><p className="eyebrow">종이 설문</p><h2>{humanDecision?"선물 주는 사람이 선택한 최종 선물":"AI가 선택한 최종 선물"}</h2><p className="body">{productFor(candidates.find((candidate:Row)=>candidate.gift_candidate_id===trial.final_selections?.[0]?.selected_candidate_id))?.product_name??"최종 선물 정보 확인 중"}</p><p className="body">연구자에게 받은 종이 설문에 응답해 주세요. 심리척도와 주관적 평가는 웹에서 입력하지 않습니다.</p><button className="button" disabled={busy} onClick={()=>void confirmPaperSurvey()}>{busy?"저장 중…":"종이 설문 작성 완료"}</button></section>}
    {role==="recipient"&&<button className="button secondary" disabled={busy} onClick={()=>void withdraw()}>연구 중단</button>}
    {phase==="completed" && <section className="experiment-task card"><h2>참여가 완료되었습니다</h2><a href="/complete" className="button">완료</a></section>}
    {role==="giver"&&["criteria","candidates","comparison","decision"].includes(phase)&&<section className="experiment-task experiment-composer card" aria-label="선물 주는 사람 대화 입력">
      <h2>{phase==="criteria"?"선물 기준 알려주기":"AI에게 질문하기"}</h2>
      <p className="body">{phase==="criteria"?"원하는 기준을 여러 개 고르거나 직접 적어 전송해 주세요. 후보 요청은 기준을 저장하고 20초가 지난 뒤 가능합니다.":"표시된 상품 정보에 관해 AI에게 질문할 수 있습니다."}</p>
      {phase==="criteria"&&<div className="experiment-quick-criteria" aria-label="추천 기준 선택"><span className="eyebrow">추천 기준</span>{RECOMMENDATION_CRITERIA.map(priority=><button type="button" key={priority} className={"experiment-quick-chip"+(selectedPriorities.includes(priority)?" is-selected":"")} aria-pressed={selectedPriorities.includes(priority)} onClick={()=>togglePriority(priority)} disabled={busy||!visible}>{priority}</button>)}</div>}
      <div className="experiment-chat-input"><input className="field" value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&(chatText.trim()||phase==="criteria"&&selectedPriorities.length)&&(ready||phase==="decision"))void sendChat(chatText.trim()?"chat":"dropdown");}} placeholder="예: 실용성, 취향 적합성" disabled={busy||!visible||(phase!=="decision"&&!ready)}/><button className="button" disabled={!(chatText.trim()||phase==="criteria"&&selectedPriorities.length)||busy||!visible||(phase!=="decision"&&!ready)} onClick={()=>void sendChat(chatText.trim()?"chat":"dropdown")}>{busy?"처리 중…":"전송"}</button></div>
      {phase==="criteria"&&<><button type="button" className="button secondary" onClick={()=>setDropdownOpen(open=>!open)}>{dropdownOpen?"선택 메뉴 접기":"선택해서 입력하기"}</button>{dropdownOpen&&<div className="experiment-dropdown"><fieldset className="experiment-criteria-menu"><legend>추천 기준 · 여러 개 선택 가능</legend>{RECOMMENDATION_CRITERIA.map(priority=><label key={priority}><input type="checkbox" checked={selectedPriorities.includes(priority)} onChange={()=>togglePriority(priority)}/>{priority}</label>)}</fieldset><label>상품 카테고리<select className="field" value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value)}><option value="">전체</option>{catalogOptions.categories.map((category:string)=><option key={category} value={category}>{category}</option>)}</select></label><label>선호 특성<select className="field" value={selectedTags[0]??""} onChange={e=>setSelectedTags(e.target.value?[e.target.value]:[])}><option value="">선택 없음</option>{catalogOptions.tags.map((tag:string)=><option key={tag} value={tag}>{tag}</option>)}</select></label><p className="eyebrow">고정 예산 {Number(profile.gift_budget??0).toLocaleString()}원 · 변경할 수 없습니다.</p><button className="button" disabled={busy||!visible||!ready} onClick={()=>void sendChat("dropdown")}>선택한 기준 적용</button></div>}</>}
      <p className="eyebrow">저장된 기준 · {normalizeCriteria(searchState?.selection_priorities??[]).join(" · ")||"중요 기준 없음"} · {searchState?.selected_category??"카테고리 전체"} · {(searchState?.preference_tags??[]).join(" · ")||"특성 선택 없음"}</p>
    </section>}

    {(["criteria","candidates","comparison"].includes(phase)) && role==="giver" && guided && phase!=="comparison" && <p className="experiment-note">연구 버전 {EXPERIMENT.version} · 참여자의 요청은 현재 단계를 확인한 뒤에만 저장됩니다.</p>}
    </div>
    </div>
  </main>;
}
