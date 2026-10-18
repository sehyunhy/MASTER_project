"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPERIMENT, MAXIMUM_EXPOSURE_MS } from "@/config/experiment";
import { productSummaryKo } from "@/lib/catalog/productSummaryKo";
import { buildProductRecommendation, type ProductEvidenceContext } from "@/lib/catalog/productEvidence";
import { buildComparison } from "@/lib/experiment/transcript";
import { normalizeCriteria, participantCriterionText, RECOMMENDATION_CRITERIA, toggleCriterion } from "@/lib/experiment/criteria";
import { relationshipForParticipant } from "@/lib/experiment/relationship";

type Role = "giver" | "recipient";
type Phase = "candidates" | "decision" | "awaiting_survey" | "completed";
type Row = any;

const phaseTitles: Record<string,string> = {
  candidates: "후보 구성", decision: "비교 및 최종 결정", awaiting_survey: "종이 설문 안내", completed: "참여 완료",
};
const progressStages = [
  {id:"candidates",label:"후보 구성"},
  {id:"decision",label:"비교 · 최종 결정"},
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
  }).replaceAll("증여자","선물 주는 사람").replaceAll("수혜자","선물 받는 사람").replaceAll("AI","Agent");
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

function CandidateCard({ candidate, allCandidates, evidenceContext, selected = false, onSelect, onToggle }: {
  candidate: Row; allCandidates: Row[]; evidenceContext:ProductEvidenceContext; selected?: boolean; onSelect?: () => void; onToggle?: () => void;
}) {
  const p = productFor(candidate);
  const recommendation=buildProductRecommendation(candidate,allCandidates,evidenceContext);
  return <article className={"experiment-candidate" + (selected ? " is-selected" : "")}>
    <div className="experiment-candidate-summary"><span className="experiment-candidate-label">후보 {labelFor(candidate.display_order)}</span><strong className="experiment-price">{Number(p.price ?? 0).toLocaleString()}원</strong></div>
    <div className="experiment-product-head">
      <img className="experiment-product-image" data-exposure-phase="candidates" src={p.image_url || "/products/category-illustration.svg"} alt="제품 종류를 나타내는 예시 이미지" loading="eager" onError={e => { const image=e.currentTarget;const fallback="/products/category-illustration.svg";if(image.getAttribute("src")!==fallback)image.src=fallback;else image.dataset.imageFailed="true"; }} />
      <div><h3>{p.product_name ?? "상품 정보"}</h3><ul className="experiment-product-summary">{productSummaryKo(p.source_product_id).map((fact,index)=><li key={index}>{fact}</li>)}</ul></div>
    </div>
    <section className="experiment-fit" aria-label="추천 이유"><h4>추천 이유</h4><p><strong>{recommendation.headline}</strong></p><ul><li><b>수혜자와의 연결</b> · {recommendation.recipientConnection}</li><li><b>상품 근거</b> · {recommendation.productEvidence}</li><li><b>비교상 강점</b> · {recommendation.comparativeStrength}</li><li><b>고려할 점</b> · {recommendation.consideration}</li></ul></section>
    {onToggle && <button type="button" className="button secondary" onClick={onToggle}>상세 보기</button>}
    {onSelect && <button type="button" className={selected ? "button" : "button secondary"} onClick={onSelect}>{selected ? "최종 후보로 선택됨" : "이 선물을 선택"}</button>}
  </article>;
}

function CandidateDetail({ candidate, onClose }: { candidate: Row; onClose: () => void }) {
  const p=productFor(candidate);
  const specs=p.specifications??{};
  const rows=(Array.isArray(specs)?specs.map((item:Row)=>[String(item.name??"규격"),item.value] as [string,unknown]):Object.entries(specs)).filter(([key,value])=>key!=="configuration_label"&&value!==null&&value!==undefined&&value!=="").slice(0,12);
  const closeRef=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{closeRef.current?.focus();},[]);
  useEffect(()=>{const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();if(event.key==="Tab"){event.preventDefault();closeRef.current?.focus();}};document.addEventListener("keydown",onKeyDown);return()=>document.removeEventListener("keydown",onKeyDown);},[onClose]);
  return <div className="experiment-detail-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <aside className="experiment-detail-panel" role="dialog" aria-modal="true" aria-label={`${p.product_name??"상품"} 상세 정보`}>
      <div className="experiment-detail-header"><div><p className="eyebrow">후보 {labelFor(candidate.display_order)} · 상품 상세</p><h2>{p.product_name??"상품 정보"}</h2></div><button ref={closeRef} type="button" className="button secondary" onClick={onClose} aria-label="상품 상세 닫기">닫기</button></div>
      <div className="experiment-detail-content"><img src={p.image_url||"/products/category-illustration.svg"} alt="제품 종류를 나타내는 예시 이미지" onError={event=>{const image=event.currentTarget;const fallback="/products/category-illustration.svg";if(image.getAttribute("src")!==fallback)image.src=fallback;}}/><div className="experiment-facts"><p><b>가격 기준</b> · 실험용 고정 환산가</p>
      {p.product_name_original && <p><b>원본 상품명</b> · {p.product_name_original}</p>}
      {p.brand && <p><b>브랜드</b> · {p.brand}</p>}
      {p.description_original && <p><b>CSV 원문 설명</b> · {String(p.description_original).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()}</p>}
      {p.price_original != null && <p><b>2024년 8월 CSV 원본가</b> · {Number(p.price_original).toFixed(2)} {p.currency_original??"USD"}</p>}
      {specs.configuration_label && <p><b>구성</b> · {specs.configuration_label}</p>}
      {rows.map(([key,value]) => <p key={key}><b>{key}</b> · {Array.isArray(value) ? value.join(", ") : String(value)}</p>)}
      {Array.isArray(p.use_cases) && <p><b>사용 상황</b> · {p.use_cases.join(" · ")}</p>}
      {Array.isArray(p.strengths) && <p><b>장점</b> · {p.strengths.join(" · ")}</p>}
      {Array.isArray(p.limitations) && <p><b>살펴볼 점</b> · {p.limitations.join(" · ")}</p>}
      {p.care_requirements && <p><b>관리</b> · {p.care_requirements}</p>}
      </div></div>
    </aside>
  </div>;
}

function ComparisonTable({ rows }: { rows: Row[] }) {
  if (!rows?.length) return <p className="body">비교 정보를 준비하고 있습니다.</p>;
  const fields: [string,string][] = [["price","가격"],["budget_fit","예산 적합성"],["core_features","핵심 특징·목적"],["recipient_fit","관심사·취향 연결"],["practicality","실용성"],["emotional_meaning","감성적 측면"],["comparative_strength","다른 후보 대비 강점"],["consideration","선택 전 고려할 점"],["best_for","우선할 기준"]];
  return <div className="experiment-table-wrap"><table className="experiment-table"><colgroup><col className="experiment-table-label-col"/>{rows.map((row:Row)=><col key={row.label}/>)}</colgroup><thead><tr><th>비교 항목</th>{rows.map((row:Row)=><th key={row.label}>{row.label} · {row.product_name}</th>)}</tr></thead><tbody>{fields.map(([key,title])=><tr key={key}><th>{title}</th>{rows.map((row:Row)=><td key={row.label}>{key === "price" ? Number(row[key] ?? 0).toLocaleString()+"원" : row[key] ?? "정보 없음"}</td>)}</tr>)}</tbody></table></div>;
}

function instructionForPhase(phase:Phase,role:Role,guided:boolean,humanDecision:boolean){
  if(phase==="candidates")return role==="recipient"?"종이로 받은 선물 받을 사람 프로필을 참고해 화면 속 후보 구성 과정을 관찰해 주세요.":guided?"프로필 자극물을 참고해 후보마다 구체적인 요청을 작성하고, 한 개씩 확인·확정해 주세요.":"화면에 표시된 후보 세 개를 살펴봐 주세요.";
  if(phase==="decision")return role==="giver"&&humanDecision?"세 후보를 비교한 뒤 하나를 선택하고, 다른 두 후보 대신 이 선물을 고른 이유를 작성해 주세요.":"비교 정보와 최종 결과를 확인해 주세요.";
  if(phase==="awaiting_survey")return "종이 설문을 마친 뒤 완료를 확인해 주세요.";
  return "참여가 완료되었습니다.";
}

export function Experiment({ role }: { role: Role }) {
  const [participantId,setParticipantId] = useState("");
  const [tabId,setTabId] = useState("");
  const [data,setData] = useState<Row|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [answers,setAnswers] = useState<Record<string,string>>({});
  const [chatText,setChatText]=useState("");
  const [selectionReason,setSelectionReason]=useState("");
  const [dropdownOpen,setDropdownOpen]=useState(false);
  const [selectedCategory,setSelectedCategory]=useState("");
  const [selectedPriorities,setSelectedPriorities]=useState<string[]>([]);
  const [selectedTags,setSelectedTags]=useState<string[]>([]);
  const [recipientStarted,setRecipientStarted]=useState(false);
  const [recipientCursor,setRecipientCursor]=useState(0);
  const [ready,setReady] = useState(false);
  const [visible,setVisible] = useState(true);
  const [exposureMs,setExposureMs] = useState(0);
  const [visibleExposureMs,setVisibleExposureMs] = useState(0);
  const [selectedId,setSelectedId] = useState("");
  const [selectedCatalogIds,setSelectedCatalogIds] = useState<string[]>([]);
  const selectedCatalogIdsRef=useRef<string[]>([]);
  const [transitionCode,setTransitionCode] = useState("");
  const [detailView,setDetailView] = useState<{candidateId:string;trialId:string;phase:Phase}|null>(null);
  const [resultTabState,setResultTabState] = useState<{phase:Phase;tab:"candidates"|"comparison"|"decision"}|null>(null);
  const viewedCandidates = useRef(new Set<string>());
  const readyAttempt = useRef("");
  const advancing = useRef("");
  const sequenceRef = useRef(0);
  const previousActive = useRef<boolean|null>(null);
  const phaseKeyRef = useRef("");
  const questionAcks = useRef(new Set<string>());
  const tabChannel = useRef<BroadcastChannel|null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement|null>(null);
  const transcriptAtBottomRef = useRef(true);
  const lastTranscriptPhaseRef = useRef("");
  const detailTriggerRef = useRef<HTMLElement|null>(null);
  const detailOpenedAtRef=useRef<number|null>(null);
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
  const phase = (trial?.current_phase ?? "candidates") as Phase;
  const conditionLabels:Record<string,string>={C1:"A",C3:"B",C2:"C",C4:"D"};
  const hasExposureClock=["candidates","decision"].includes(phase);
  const guided = trial?.execution_autonomy === "human_guided";
  const humanDecision = trial?.decision_authority === "human";
  const messages: Row[] = useMemo(() => [...(trial?.trial_messages ?? [])].sort((a:Row,b:Row) => new Date(a.created_at).getTime()-new Date(b.created_at).getTime()),[trial?.trial_messages]);
  const candidates: Row[] = useMemo(() => [...(trial?.trial_candidates ?? [])].sort((a:Row,b:Row)=>a.display_order-b.display_order),[trial?.trial_candidates]);
  const candidateContentReady=Boolean(trial?.candidate_mode==="human_sequential"&&role==="giver")||Boolean(messages.some((message:Row)=>message.message_type==="product_cards")&&candidates.length===3);
  const pendingProposal:Row|undefined=[...(trial?.v6_candidate_requests??[])].reverse().find((request:Row)=>request.status==="proposed");
  const currentExposure = (trial?.trial_phase_exposures ?? []).find((x:Row)=>x.phase===phase);
  const searchState=data?.searchState;
  const catalogOptions=data?.catalogOptions??{categories:[],tags:[],eligibleCount:0,items:[]};
  const filteredCatalogCount=(catalogOptions.items??[]).filter((item:Row)=>(!searchState?.selected_category||item.category===searchState.selected_category)&&(!(searchState?.preference_tags??[]).length||(searchState.preference_tags as string[]).some(tag=>(item.search_tags_ko??[]).includes(tag)))).length;
  const catalogReady=filteredCatalogCount>=3;
  const shownMessages=role==="recipient"?messages.slice(0,recipientCursor):messages;
  useEffect(()=>{
    if(!trial)return;
    const count=shownMessages.length;
    const previous=lastMessageCount.current;
    const phaseKey=trial.id+":"+phase;
    const phaseChanged=lastTranscriptPhaseRef.current!==phaseKey;
    lastTranscriptPhaseRef.current=phaseKey;
    lastMessageCount.current={trialId:trial.id,count};
    const panel=transcriptScrollRef.current;
    if(!panel||!visible)return;
    if(phaseChanged&&count>0){transcriptAtBottomRef.current=true;requestAnimationFrame(()=>panel.scrollTo({top:panel.scrollHeight}));}
    else if(previous.trialId===trial.id&&count>previous.count&&transcriptAtBottomRef.current){requestAnimationFrame(()=>{panel.scrollTop=panel.scrollHeight;});}
  },[trial?.id,phase,shownMessages.length,visible]);
  useEffect(()=>{setSelectedCategory(searchState?.selected_category??"");setSelectedPriorities(normalizeCriteria(searchState?.selection_priorities??[]));setSelectedTags(searchState?.preference_tags??[]);},[trial?.id,searchState?.state_version]);
  useEffect(()=>{selectedCatalogIdsRef.current=[];setSelectedCatalogIds([]);detailOpenedAtRef.current=null;setDetailView(null);},[trial?.id]);

  useEffect(()=>{
    if(trial?.experiment_version!=="6.0.0"||phase!=="decision"||role!=="giver"||!humanDecision||!selectedId||!selectionReason.trim()||trial.final_selections?.length)return;
    const timer=window.setTimeout(()=>{
      void fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save_selection_reason",participantId,trialId:trial.id,candidateId:selectedId,reasonText:selectionReason.trim(),idempotencyKey:crypto.randomUUID()})})
        .then(async response=>{if(!response.ok){const result=await response.json();throw new Error(result.error??"선택 이유를 저장하지 못했습니다.");}})
        .catch(error=>setError((error as Error).message));
    },650);
    return()=>window.clearTimeout(timer);
  },[trial?.id,trial?.experiment_version,trial?.final_selections?.length,phase,role,humanDecision,selectedId,selectionReason,participantId]);

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
    if (!trial || !tabId || !participantId || !visible || !["candidates","decision"].includes(phase)) return;
    if(phase==="candidates"&&!candidateContentReady)return;
    if(role==="recipient"&&!recipientStarted)return;
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
        setExposureMs(Number(result.effective_exposure_ms??result.accumulated_ms??currentExposure?.effective_exposure_ms??currentExposure?.accumulated_ms??0));
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
  },[trial?.id,phase,tabId,participantId,visible,messages,recipientStarted,recipientCursor,role,currentExposure?.accumulated_ms,load,candidateContentReady]);

  useEffect(() => {
    if (!trial || !tabId || !participantId || !visible || !["decision","awaiting_survey"].includes(phase)) return;
    if(role==="recipient"&&!recipientStarted)return;
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
    if (!ready || !trial || !tabId || !participantId || !["candidates","decision"].includes(phase)) return;
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
        if (result.accepted!==false) setExposureMs(Number(result.effective_exposure_ms??result.accumulated_ms??0));
        if (result.timed_out) { setReady(false); await load(); }
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
    setVisibleExposureMs(exposureMs);
    if(!hasExposureClock||!ready||!visible||exposureMs>=EXPERIMENT.minimumPhaseExposureMs)return;
    const startedAt=performance.now();
    const timer=window.setInterval(()=>setVisibleExposureMs(Math.min(EXPERIMENT.minimumPhaseExposureMs-1,exposureMs+performance.now()-startedAt)),250);
    return()=>window.clearInterval(timer);
  },[trial?.id,phase,hasExposureClock,exposureMs,ready,visible]);

  useEffect(() => {
    if (!trial || phase!=="candidates" || trial.candidate_mode==="human_sequential"&&role==="giver" || messages.some((message:Row)=>message.message_type==="product_cards") || !tabId) return;
    setBusy(true);
    fetch("/api/experiment/phase",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"retry_generation",participantId,trialId:trial.id,tabId})})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error??"후보를 준비하지 못했습니다.");await load();})
      .catch(e=>setError((e as Error).message)).finally(()=>setBusy(false));
  },[trial?.id,phase,role,messages,participantId,tabId,load]);

  // v6 phase transitions are always explicit participant actions after the
  // minimum exposure; the clock never moves the experiment on by itself.

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
      if(trial.experiment_version==="6.0.0"&&phase==="candidates"&&trial.candidate_mode==="human_sequential"){
        if(inputMode!=="chat"||!chatText.trim())throw new Error("이번 후보의 구체적인 요청을 직접 작성해 주세요.");
        const response=await fetch("/api/experiment/candidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"request",participantId,trialId:trial.id,tabId,text:chatText.trim(),idempotencyKey:crypto.randomUUID()})});
        const result=await response.json();if(!response.ok)throw new Error(result.error??"후보를 만들지 못했습니다.");
        setChatText("");await load();return;
      }
      const response=await fetch("/api/experiment/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,trialId:trial.id,tabId,inputMode,text:inputMode==="chat"?chatText:"",selectedCategory:selectedCategory||null,selectedPriorities,preferenceTags:selectedTags,requestIntent,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"대화를 저장하지 못했습니다.");
      if(inputMode==="chat")setChatText("");
      await load();
      if(result.finalCandidateId){
        const pick=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"select",participantId,trialId:trial.id,candidateId:result.finalCandidateId,eventTarget:"chat",tabId})});
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
    const activeDetail=detailView&&detailView.trialId===trial.id&&detailView.phase===phase?detailView:null;
    const isOpen=activeDetail?.candidateId===id;
    const previousId=activeDetail?.candidateId;
    if(!isOpen)detailTriggerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setDetailView(isOpen?null:{candidateId:id,trialId:trial.id,phase});
    try {
      if(isOpen){const dwellMs=detailOpenedAtRef.current?Math.max(0,Date.now()-detailOpenedAtRef.current):null;detailOpenedAtRef.current=null;await log("candidate_closed",id,labelFor(candidate.display_order),{dwellMs});requestAnimationFrame(()=>detailTriggerRef.current?.focus());}
      else {
        if(previousId){const previousCandidate=candidates.find(item=>item.gift_candidate_id===previousId);if(previousCandidate){const dwellMs=detailOpenedAtRef.current?Math.max(0,Date.now()-detailOpenedAtRef.current):null;await log("candidate_closed",previousId,labelFor(previousCandidate.display_order),{dwellMs});}}
        detailOpenedAtRef.current=Date.now();
        const prior=viewedCandidates.current.has(id);
        await log(prior?"candidate_revisited":"candidate_opened",id,labelFor(candidate.display_order));
        await log("candidate_detail_viewed",id,labelFor(candidate.display_order));
        viewedCandidates.current.add(id);
      }
    } catch(e) { setError((e as Error).message); }
  }

  async function finalizeChoice() {
    if (!selectedId||selectionReason.trim().length<15) return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"select",participantId,trialId:trial.id,candidateId:selectedId,tabId,reasonText:selectionReason.trim()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"선택을 저장하지 못했습니다.");
      await load();
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmSequentialCandidate(requestId:string){
    if(!trial||busy)return;setBusy(true);setError("");
    try{const response=await fetch("/api/experiment/candidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"confirm",participantId,trialId:trial.id,tabId,requestId,idempotencyKey:crypto.randomUUID()})});const result=await response.json();if(!response.ok)throw new Error(result.error??"후보를 확정하지 못했습니다.");await load();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
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

  async function submitTransitionCode(event:React.FormEvent) {
    event.preventDefault();if(!participantId||busy)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/experiment/transition",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,code:transitionCode,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"코드를 확인하지 못했습니다.");
      setTransitionCode("");await load();
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  async function confirmTrialIntro(){
    if(!trial||busy)return;setBusy(true);setError("");
    try{
      const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"confirm_trial_intro",participantId,trialId:trial.id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"단계를 시작하지 못했습니다.");await load();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  async function submitHumanCandidateSet() {
    if(!trial||selectedCatalogIds.length!==3||busy)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"compose_candidates_v5",participantId,trialId:trial.id,tabId,sourceProductIds:selectedCatalogIds,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"후보를 저장하지 못했습니다.");
      selectedCatalogIdsRef.current=[];setSelectedCatalogIds([]);await load();
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  function toggleCatalogProduct(id:string){
    const current=selectedCatalogIdsRef.current;
    if(current.includes(id)){const next=current.filter(item=>item!==id);selectedCatalogIdsRef.current=next;setSelectedCatalogIds(next);void log("candidate_pool_unselected",id,undefined,{selectedBefore:current.length}).catch(e=>setError((e as Error).message));return;}
    if(current.length>=3)return;
    const next=[...current,id];selectedCatalogIdsRef.current=next;setSelectedCatalogIds(next);
    void log("candidate_pool_selected",id,undefined,{selectionOrder:next.length}).catch(e=>setError((e as Error).message));
  }

  function changeResultTab(tab:"candidates"|"comparison"|"decision"){
    setResultTabState({phase,tab});
    if(tab==="comparison")void log("comparison_interacted",undefined,"comparison_tab",{phase,informationalView:true}).catch(e=>setError((e as Error).message));
  }

  if (error && !data) return <section className="panel"><h1 className="title">연구 정보를 불러오지 못했습니다</h1><p role="alert">{error}</p><button className="button" onClick={()=>load().catch(e=>setError(e.message))}>다시 불러오기</button></section>;
  if (!data) return <section className="panel">연구 정보를 불러오는 중…</section>;
  if(data.transitionRequired)return <main className="experiment-shell v5-transition"><section className="panel"><p className="eyebrow">조건 전환</p><h1 className="title">다음 조건을 시작합니다</h1><p className="body">이전 조건의 체험과 설문 확인이 완료되었습니다. 연구자에게 전달받은 현재 순서의 전환 코드를 입력해 주세요.</p><p className="body">현재 {Number(data.studySession?.next_trial_number??1)}번째 조건 · 전체 4개 조건</p>{error&&<p className="experiment-error" role="alert">{error}</p>}<form onSubmit={submitTransitionCode}><label>전환 코드<input className="field" inputMode="numeric" autoComplete="off" value={transitionCode} onChange={e=>setTransitionCode(e.target.value.replace(/\D/g,"").slice(0,6))} required pattern="[0-9]{3,6}" /></label><button className="button" disabled={busy||transitionCode.length<3}>{busy?"확인 중…":"코드 확인 후 계속"}</button></form></section></main>;
  if(data.preflightRequired)return <main className="experiment-shell v5-preflight"><section className="panel"><p className="eyebrow">조건 {trial.trial_number} / 4 · {trial.condition_id}</p><h1 className="title">선물 받는 사람 정보를 확인합니다</h1><p className="body">{trial.experiment_version==="6.0.0"?"연구자가 제공한 종이 자극물에서 선물 받을 사람의 프로필과 고정 예산을 확인한 뒤 선물하기를 시작해 주세요.":"아래 프로필과 고정 예산을 확인한 뒤 선물하기를 시작해 주세요."} 이 확인 전에는 실험 단계 시간이 시작되지 않습니다.</p><section className="experiment-profile card">{trial.experiment_version==="6.0.0"?<><p className="eyebrow">종이 자극물</p><h2>선물 받을 사람 프로필</h2><p className="body">프로필과 예산은 종이로 받은 자료에서 확인해 주세요. 앱에는 실제 상품 후보와 비교 결과가 표시됩니다.</p></>:<><p className="eyebrow">선물 받는 사람</p><h2>{trial.recipient_profiles?.name??trial.recipient_profiles?.profile_code}</h2><p className="body">{trial.recipient_profiles?.age}세{trial.recipient_profiles?.occupation?` · ${trial.recipient_profiles.occupation}`:""}</p><p className="body"><b>관심사</b> · {(trial.recipient_profiles?.hobbies??[]).join(" · ")}</p><p className="body"><b>선호</b> · {trial.recipient_profiles?.preference}</p><p className="body"><b>피할 조건</b> · {trial.recipient_profiles?.dislike}</p><p className="experiment-budget">고정 예산 · {Number(trial.recipient_profiles?.gift_budget??0).toLocaleString()}원</p></>}</section><p className="body">현재 조건: 후보 세 개 구성은 {trial.candidate_builder==="human"?"선물 주는 사람":"Agent"}, 최종 선물 확정은 {trial.decision_authority==="human"?"선물 주는 사람":"Agent"}이 담당합니다.</p>{role==="recipient"&&<p className="body">이 역할은 연구자가 검토한 시나리오를 관찰합니다. 화면 속 행동은 다른 참가자의 실제 행동이 아닙니다.</p>}{error&&<p className="experiment-error" role="alert">{error}</p>}<button className="button" disabled={busy} onClick={()=>void confirmTrialIntro()}>{busy?"준비 중…":"선물하기 시작"}</button></section></main>;
  if (!trial) {
    const subject=data.studySession?.research_subjects;
    const nextRole=subject&&Number(subject.current_role_index)<2?subject.role_order?.[Number(subject.current_role_index)]:null;
    return <main className="experiment-shell v5-role-complete"><section className="panel"><p className="eyebrow">{nextRole?"첫 번째 역할이 완료되었습니다":"연구 완료"}</p><h1 className="title">{nextRole?"다음 역할을 진행합니다":"참여해 주셔서 감사합니다"}</h1><p className="body">{nextRole?`이제 ${nextRole==="giver"?"선물 주는 사람":"선물 받는 사람"} 역할을 시작해 주세요. 두 역할은 별도의 응답으로 저장됩니다.`:"모든 단계가 저장되었습니다."}</p>{nextRole?<a className="button" href="/start">다음 역할 시작</a>:<a className="button" href="/complete">완료</a>}</section></main>;
  }

  const profile=trial.recipient_profiles ?? {};
  const exposurePercent=Math.min(100,visibleExposureMs/EXPERIMENT.minimumPhaseExposureMs*100);
  const allGuidedAnswers=EXPERIMENT.questions.every(q=>Boolean(answers[q.id]));
  const canRequest=ready && visible && exposureMs>=EXPERIMENT.minimumPhaseExposureMs && !busy;
  const taskOwner=guided?"선물 주는 사람":"Agent";
  const decisionOwner=humanDecision?"선물 주는 사람":"Agent";
  const stageIndex=progressStages.findIndex(stage=>stage.id===phase);
  const candidateMessageShown=shownMessages.some((message:Row)=>message.message_type==="product_cards");
  const comparisonMessage=[...shownMessages].reverse().find((message:Row)=>message.message_type==="comparison");
  const finalCandidate=candidates.find(candidate=>candidate.gift_candidate_id===trial.final_selections?.[0]?.selected_candidate_id);
  const recordedDecisionExplanation=[...shownMessages].reverse().find((message:Row)=>message.phase==="decision"&&message.message_type==="decision"&&message.content&&!String(message.content).startsWith("선물 주는 사람이 선택한 최종 선물:")&&!String(message.content).startsWith("Agent가 선택한 최종 선물:")&&!String(message.content).startsWith("비교를 마쳤습니다."));
  const detailCandidate=detailView&&detailView.trialId===trial.id&&detailView.phase===phase?candidates.find(candidate=>candidate.gift_candidate_id===detailView.candidateId):undefined;
  const decisionVisible=role==="giver"||recipientCursor>=messages.length;
  const availableResultTabs={
    candidates:candidateMessageShown&&candidates.length>0,
    comparison:Boolean(comparisonMessage),
    decision:(["decision","awaiting_survey","completed"].includes(phase))&&decisionVisible,
  };
  const defaultResultTab: "candidates"|"comparison"|"decision" = ["decision","awaiting_survey","completed"].includes(phase)?(trial.final_selections?.length?"decision":"comparison"):"candidates";
  const requestedResultTab=resultTabState?.phase===phase?resultTabState.tab:defaultResultTab;
  const resultTab=availableResultTabs[requestedResultTab]?requestedResultTab:defaultResultTab;
  const canReviewOtherResults=!hasExposureClock||exposureMs>=EXPERIMENT.minimumPhaseExposureMs;
  const relationship=data.participant?.experiment_version==="5.0.0"?{heading:"선물 선택 상황",conditionLabel:"고정된 수혜자 프로필",situation:"모든 조건에서 동일한 프로필과 예산을 사용합니다.",intimacyCondition:null}:data.relationship??relationshipForParticipant(data.participant?.intimacy_condition,data.participant?.role,undefined,{version:trial.profile_version,name:profile.name,relationshipType:trial.relationship_type});
  const currentInstruction=instructionForPhase(phase,role,guided,humanDecision);
  const observedPriority=shownMessages.find((message:Row)=>message.payload?.selectedPriority)?.payload?.selectedPriority;
  const evidenceContext:ProductEvidenceContext={
    profile,budget:Number(profile.gift_budget??0),intimacyCondition:relationship.intimacyCondition,
    priorities:role==="recipient"?normalizeCriteria(typeof observedPriority==="string"?[observedPriority]:[]):normalizeCriteria(searchState?.selection_priorities??[]),
  };
  const comparisonRows=comparisonMessage?.payload?.rows?.[0]?.budget_fit
    ?comparisonMessage.payload.rows:comparisonMessage?buildComparison(candidates,evidenceContext):[];
  const latestAgentMessageId=[...shownMessages].reverse().find((message:Row)=>message.actor_type==="agent")?.id;

  return <main className={`experiment-shell role-${role} phase-${phase}${hasExposureClock?" has-exposure-clock":""}`}>
    <header className="experiment-header">
      <div className="experiment-brand"><span className="experiment-brand-mark" aria-hidden="true">✦</span><span>선물 추천 Agent</span><span className="experiment-brand-role">본 실험 · {role==="giver"?"선물 주는 사람":"선물 받는 사람"} · {trial.trial_number} / 4</span></div>
      <div className="experiment-header-summary"><div><h1 className="title">{phaseTitles[phase] ?? "선물 추천 연구"}</h1><p className="experiment-current-task">{currentInstruction}</p></div><div className="experiment-header-time" aria-label="현재 단계 확인 시간" role="status">{hasExposureClock?<><b>유효 체험</b><strong>{!ready?"준비 중":!visible?"화면 이탈 · 시간 중지":exposureMs>=MAXIMUM_EXPOSURE_MS?"최대 시간 종료":exposureMs>=EXPERIMENT.minimumPhaseExposureMs?"최소 시간 충족 · 직접 진행 가능":`${Math.floor(visibleExposureMs/1000)} / ${EXPERIMENT.minimumPhaseExposureMs/1000}초`}</strong><span>최대 {Math.max(0,Math.ceil((MAXIMUM_EXPOSURE_MS-visibleExposureMs)/1000))}초 남음</span><div className="experiment-header-progress" role="progressbar" aria-label="현재 단계 최소 체험시간 진행률" aria-valuemin={0} aria-valuemax={EXPERIMENT.minimumPhaseExposureMs/1000} aria-valuenow={Math.min(EXPERIMENT.minimumPhaseExposureMs/1000,Math.floor(visibleExposureMs/1000))}><span style={{width:String(exposurePercent)+"%"}}/></div></>:<><b>현재 단계</b><strong>{phaseTitles[phase]}</strong></>}</div></div>
      <div className="experiment-roles"><span>후보 3개 구성 · <b>{trial.candidate_builder==="human"?"선물 주는 사람":"Agent"}</b></span><span>최종 선택 · <b>{decisionOwner}</b></span></div>
      <ol className="experiment-phase-step" aria-label="선물 선택 진행 단계">{progressStages.map((stage,index)=><li key={stage.id} className={index===stageIndex?"is-active":index<stageIndex||stageIndex<0?"is-complete":""} aria-current={index===stageIndex?"step":undefined}><span>{index+1}</span>{stage.label}</li>)}</ol>
    </header>

    {error && <p className="experiment-error" role="alert">{error}</p>}

    <div className="experiment-main-grid">
    <aside className="experiment-context">
    <section className="experiment-profile card" aria-label="선물 받는 사람 정보">
      {data.participant?.experiment_version!=="5.0.0"&&<div className="experiment-relationship"><p className="eyebrow">{relationship.heading}</p><strong>{relationship.conditionLabel}</strong>{relationship.situation&&<p className="body">{relationship.situation}</p>}</div>}
      {trial.experiment_version==="6.0.0"?<><p className="body">선물 받을 사람의 프로필과 고정 예산은 종이 자극물에서 확인해 주세요.</p><p className="experiment-budget">종이 자극물의 예산과 상품 정보는 이 조건에서 고정됩니다.</p></>:<><div className="experiment-profile-meta"><div><p className="eyebrow">선물 받는 사람</p><h2>{profile.name ?? profile.profile_code}</h2><p className="body">{profile.age}세{profile.gender?` · ${profile.gender}`:""}</p></div></div>
      {profile.participant_text?<p className="body experiment-persona-text">{profile.participant_text}</p>:<div className="experiment-profile-core"><p className="body"><b>관심사</b> · {(profile.hobbies ?? []).join(" · ")}</p><p className="body"><b>선호</b> · {profile.preference}</p><p className="body"><b>피할 조건</b> · {profile.dislike}</p></div>}
      <div className="experiment-gift-context"><p className="eyebrow">선물 상황</p><p className="body">{role==="recipient"?`당신의 ${profile.gift_occasion}을 맞아 선물을 받는 상황입니다.`:`${profile.name}의 ${profile.gift_occasion} 선물을 선택하는 상황입니다.`}</p><span className="experiment-budget">예산 {Number(profile.gift_budget ?? 0).toLocaleString()}원</span></div></>}
      <div className="experiment-profile-criteria"><p className="eyebrow">선택된 추천 기준</p><p className="body">{normalizeCriteria(searchState?.selection_priorities??[]).join(" · ")||"없음"}{searchState?.selected_category?` · ${searchState.selected_category}`:""}</p></div>
      {trial.experiment_version!=="6.0.0"&&<details className="experiment-profile-more"><summary>선물 받는 사람 상세 정보</summary><div className="experiment-profile-more-content"><p className="body">{profile.recent_interest}</p><p className="body">{profile.lifestyle_context}</p>{searchState?.query_text&&<p className="body">직접 입력 · {participantFacingText(searchState.query_text)}</p>}</div></details>}
    </section>

    {role==="giver"&&data?.aiConfigured===false&&<p className="experiment-error" role="status">Agent 대화 설정이 완료되지 않았습니다. 연구자가 Vercel Production의 ANTHROPIC_API_KEY를 확인하고 새 배포를 해야 합니다.</p>}
    </aside>
    <div className="experiment-workspace">
    <section className="experiment-transcript" aria-label="추천 대화 기록">
      <div className="experiment-section-heading"><div><p className="eyebrow">저장되는 대화</p><h2>추천 과정</h2></div><span className="experiment-phase-pill">{phaseTitles[phase]}</span></div>
      <div className="experiment-transcript-scroll" ref={transcriptScrollRef} onScroll={event=>{const panel=event.currentTarget;transcriptAtBottomRef.current=panel.scrollHeight-panel.scrollTop-panel.clientHeight<80;}}>
      {trial.experiment_version==="6.0.0"&&(data?.trials??[]).filter((previous:Row)=>previous.trial_number<trial.trial_number).map((previous:Row)=><section className="experiment-history-trial" key={`history-${previous.id}`} aria-label={`이전 조건 ${conditionLabels[previous.condition_id]??previous.condition_id}`}><div className="experiment-history-divider">조건 {conditionLabels[previous.condition_id]??previous.condition_id} 완료 · 이전 대화</div>{[...(previous.trial_messages??[])].sort((a:Row,b:Row)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).map((message:Row)=><article key={`history-${message.id}`} className={`experiment-message ${message.actor_type==="agent"||message.actor_type==="system"?"from-agent":"from-person"}`}><div className="experiment-message-bubble"><p className="experiment-speaker">{message.actor_type==="agent"||message.actor_type==="system"?"Agent":message.simulated_actor_event||message.actor_type==="simulated_giver"?"선물 주는 사람(연구 시나리오)":"선물 주는 사람"} · 이전 조건</p>{message.content&&<p className="body">{participantFacingText(message.content)}</p>}</div></article>)}</section>)}
      {trial.experiment_version==="6.0.0"&&<div className="experiment-history-divider">조건 {conditionLabels[trial.condition_id]??trial.condition_id} 시작 · {phase==="decision"?"2단계 · 후보 비교와 최종 결정":"1단계 · 후보 만들기"}</div>}
      {shownMessages.map((message:Row,index:number)=>{
        const previousPhase=index>0?shownMessages[index-1].phase:null;
        const phaseDivider=trial.experiment_version==="6.0.0"&&message.phase!==previousPhase&&((message.phase==="decision"&&phase!=="awaiting_survey")||(message.phase==="candidates"&&index===0));
        const agent=message.actor_type==="agent"||message.actor_type==="system";
        const speaker=message.simulated_actor_event||message.actor_type==="simulated_giver"?`선물 주는 사람(${data?.stimulusSource==="recorded"?"기록 재생":"연구 시나리오"})`:agent?"Agent":"선물 주는 사람";
        return <Fragment key={message.id}>{phaseDivider&&<div className="experiment-history-divider">{message.phase==="decision"?"2단계 · 후보 비교와 최종 결정":"1단계 · 후보 만들기"}</div>}<article className={"experiment-message "+(agent?"from-agent":"from-person")+(message.id===latestAgentMessageId?" is-latest-agent":"")}>
          <div className="experiment-message-bubble">
          <p className="experiment-speaker">{speaker}{message.simulated_actor_event&&<span> · 시나리오 재생</span>}</p>
          {message.content && <p className="body">{participantFacingText(message.content)}</p>}
          {role==="recipient"&&message.payload?.inputMode==="dropdown"&&<div className="scripted-dropdown" aria-label="선물 주는 사람이 선택한 드롭다운 기준"><label>선물 주는 사람이 선택한 상품 카테고리<select disabled value={message.payload.selectedCategory??""}><option>{message.payload.selectedCategory??""}</option></select></label><label>선물 주는 사람이 선택한 중요 기준<select disabled value={participantCriterionText(message.payload.selectedPriority??"")}><option>{participantCriterionText(message.payload.selectedPriority??"")}</option></select></label></div>}
          </div>
        </article></Fragment>;
      })}
      {!messages.length && <p className="body">추천 과정의 대화를 준비하고 있습니다.</p>}
      </div>
    </section>
    {role==="giver"&&phase==="candidates"&&trial.candidate_mode==="human_sequential"&&<section className="experiment-task experiment-composer card" aria-label="선물 주는 사람 후보 요청 입력">
      <h2>후보 {Math.min(candidates.length+1,3)} / 3 요청</h2>
      <p className="body">종이로 받은 선물 받을 사람 프로필을 보고, 그 사람의 구체적인 관심사·사용 상황과 이번 후보의 방향을 직접 적어 주세요. 포괄적인 위임 요청은 거부됩니다.</p>
      <div className="experiment-chat-input"><input className="field" value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&chatText.trim())void sendChat("chat");}} placeholder="예: 집에서 매일 쓰는 간단한 피부 관리용품을 찾아주세요" disabled={busy||!visible||!ready||candidates.length>=3}/><button className="button" disabled={!chatText.trim()||busy||!visible||!ready||candidates.length>=3} onClick={()=>void sendChat("chat")}>{busy?"처리 중…":"한 개 요청"}</button></div>
    </section>}
    </div>
    <aside className="experiment-results" aria-label="선물 후보와 비교 결과">
      <div className="experiment-results-header"><div><p className="eyebrow">상품 결과</p><h2>{resultTab==="comparison"?"후보 비교":resultTab==="decision"?"최종 결정":"선물 후보"}{resultTab!=="comparison"&&<span className="experiment-results-scroll-hint"> · 좌우로 밀어 모두 보기 →</span>}</h2></div><div className="experiment-results-tabs" role="tablist" aria-label="상품 결과 다시 보기">
        {(["candidates","comparison","decision"] as const).map(tab=><button key={tab} type="button" role="tab" aria-selected={resultTab===tab} className={resultTab===tab?"is-active":""} disabled={!availableResultTabs[tab]||(tab!==defaultResultTab&&!canReviewOtherResults)} onClick={()=>changeResultTab(tab)}>{tab==="candidates"?"후보 3개":tab==="comparison"?"비교표":"선택 결과"}</button>)}
      </div></div>
      <div key={`${trial.id}:${phase}:${resultTab}`} className="experiment-results-body" role="tabpanel">
        {phase==="candidates"&&role==="giver"&&pendingProposal&&<section className="v6-candidate-proposal"><CandidateCard candidate={{gift_candidate_id:`pending-${pendingProposal.id}`,display_order:pendingProposal.slot_number,product_snapshot:pendingProposal.product_snapshot}} allCandidates={candidates} evidenceContext={evidenceContext}/><p className="body">{pendingProposal.response_text}</p><button type="button" className="button" disabled={busy||!ready||!visible} onClick={()=>void confirmSequentialCandidate(pendingProposal.id)}>이 상품을 후보 {pendingProposal.slot_number}로 확정</button><p className="eyebrow">원하는 방향이 아니면 위 입력란에서 요청을 구체화해 다시 물어볼 수 있습니다.</p></section>}
        {resultTab==="candidates"&&(availableResultTabs.candidates?<div className="experiment-card-list">{candidates.map(candidate=><CandidateCard key={candidate.id} candidate={candidate} allCandidates={candidates} evidenceContext={evidenceContext} onToggle={()=>void toggleCandidate(candidate)}/>)}</div>:<div className="experiment-results-empty"><h3>상품 후보를 준비하고 있습니다</h3><p className="body">추천 기준이 확인되면 후보 3개가 이곳에 표시됩니다.</p></div>)}
        {resultTab==="comparison"&&(comparisonMessage?<div data-exposure-phase="comparison"><ComparisonTable rows={comparisonRows}/></div>:<div className="experiment-results-empty"><h3>비교 결과를 준비하고 있습니다</h3></div>)}
        {resultTab==="decision"&&<div className="experiment-decision-result">
          {role==="giver"&&phase==="decision"&&humanDecision&&!finalCandidate&&<><p className="body">세 후보를 살펴본 뒤 최종 선물 하나를 선택해 주세요.</p><div className="experiment-card-list">{candidates.map(candidate=><CandidateCard key={candidate.id} candidate={candidate} allCandidates={candidates} evidenceContext={evidenceContext} selected={selectedId===candidate.gift_candidate_id} onSelect={()=>void choose(candidate)} onToggle={()=>void toggleCandidate(candidate)}/>)}</div></>}
          {finalCandidate&&decisionVisible&&<><p className="eyebrow">{humanDecision?"선물 주는 사람이 선택한 최종 선물":"Agent가 선택한 최종 선물"}</p><div className="experiment-final-product"><CandidateCard candidate={finalCandidate} allCandidates={candidates} evidenceContext={evidenceContext} selected onToggle={()=>void toggleCandidate(finalCandidate)}/></div>{recordedDecisionExplanation?.content&&<div className="experiment-decision-explanation"><h3>선택 과정 기록</h3><p>{participantFacingText(recordedDecisionExplanation.content)}</p></div>}</>}
          {!finalCandidate&&!(role==="giver"&&phase==="decision"&&humanDecision)&&<div className="experiment-results-empty"><h3>최종 선택을 기다리고 있습니다</h3><p className="body">선택 결과는 이곳에 표시됩니다.</p></div>}
        </div>}
      </div>
    </aside>
    </div>
    <footer className="experiment-footer" aria-label="단계 진행">
      <section className="experiment-footer-action" aria-label="현재 단계 안내와 진행">
        {role==="recipient"&&!recipientStarted&&<><div><b>관찰을 시작합니다</b><p>{data?.stimulusSource==="recorded"?"기록된 대화를 검토해 만든 관찰 자극입니다.":"연구자가 구성하고 검토한 시나리오입니다."} 화면 속 선물 주는 사람의 입력은 당신의 행동으로 기록되지 않습니다.</p></div><button className="button" onClick={startObservation}>관찰 시작</button></>}
        {phase==="candidates"&&<><div><b>{role==="giver"&&guided?"후보를 하나씩 요청·확정해 주세요":"세 후보를 살펴봐 주세요"}</b><p>{role==="giver"&&guided?`${candidates.length} / 3개 확정 · ${Math.max(0,Math.ceil((EXPERIMENT.minimumPhaseExposureMs-visibleExposureMs)/1000))}초 뒤 다음 단계로 갈 수 있습니다.`:"후보 단계의 최소 확인시간이 지나면 다음 단계로 이동할 수 있습니다."}</p></div><button className="button" disabled={!canRequest||candidates.length!==3} onClick={()=>void advance(true)}>{busy?"저장 중…":"후보 단계 완료 · 비교로 이동"}</button></>}
        {phase==="decision"&&role==="giver"&&humanDecision&&!trial.final_selections?.length&&<><div><b>세 후보를 비교해 하나를 선택해 주세요</b><p>다른 두 후보 대신 이 선물을 고른 이유를 직접 작성해야 확정할 수 있습니다.</p></div><textarea className="field" value={selectionReason} onChange={event=>setSelectionReason(event.target.value)} rows={3} maxLength={1000} placeholder="이 선물을 선택한 이유를 직접 작성해 주세요. 다른 후보와 비교한 점도 적어 주세요." aria-label="선물 선택 이유"/><button className="button" disabled={!selectedId||selectionReason.trim().length<15||busy||!canRequest} onClick={()=>void finalizeChoice()}>{busy?"저장 중…":"선택과 이유 확정"}</button></>}
        {phase==="decision"&&<><div><b>{trial.final_selections?.length?"최종 결과를 확인해 주세요":"비교표와 최종 결정을 확인해 주세요"}</b><p>{trial.final_selections?.length?"최소 확인시간을 채운 뒤 설문 단계로 진행할 수 있습니다.":"Agent 최종 결정 또는 본인의 최종 선택을 확인해 주세요."}</p></div><button className="button" disabled={!canRequest||!trial.final_selections?.length} onClick={()=>void advance(true)}>{canRequest?"비교·결정 단계 완료":"최소 확인시간 확인 중…"}</button></>}
        {phase==="awaiting_survey"&&(role!=="recipient"||recipientCursor>=messages.length)&&<><div><b>종이 설문 안내</b><p>{trial.completion_outcome==="timeout"&&!finalCandidate?"시간 초과로 완료하지 못한 행동은 미완료로 기록되었습니다.":"선택 결과를 확인한 뒤 연구자에게 받은 종이 설문에 응답해 주세요."}</p></div><button className="button" disabled={busy||(!finalCandidate&&trial.completion_outcome!=="timeout")} onClick={()=>void confirmPaperSurvey()}>{busy?"저장 중…":"종이 설문 작성 완료"}</button></>}
        {phase==="completed"&&<><div><b>참여가 완료되었습니다</b></div><a href="/complete" className="button">완료</a></>}
        {role==="recipient"&&<button className="button secondary experiment-withdraw" disabled={busy} onClick={()=>void withdraw()}>연구 중단</button>}
      </section>
    </footer>
    {detailCandidate&&<CandidateDetail candidate={detailCandidate} onClose={()=>void toggleCandidate(detailCandidate)}/>}
  </main>;
}
