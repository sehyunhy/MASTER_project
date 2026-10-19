"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAXIMUM_PHASE_MS, MINIMUM_PHASE_MS } from "@/lib/study/config";

type Role = "giver" | "recipient";
type Product = { source_product_id: string; name_ko: string; name_original: string; description_original: string;
  image_url: string; price_krw: number; price_original_usd?: number; category: string; reason?: string; source_url?: string };
type Trial = { id: string; role: Role; condition: "A"|"B"|"C"|"D"; order_position: number;
  profile_code: string;
  candidate_builder: "human"|"agent"; decision_actor: "human"|"agent"; phase: string; phase_effective_ms: number;
  candidate_snapshots: Product[]; candidates_visible_at?: string | null;
  proposal?: { request_key: string; product: Product; reply: string } | null;
  final_product_id?: string | null; final_actor?: string | null; final_reason?: string | null; stimulus_id?: string | null;
  survey_completed_at?: string | null; operator_review_needed?: boolean;
  timeout_phase?: string | null; skipped_at?: string | null };
type Message = { id: number; trial_id: string; phase: string; speaker: string; origin: string; kind: string;
  content: string; payload: Record<string, any> };
type PendingCandidate = { trialId: string; requestKey: string; product: Product; slot: number };
type State = { person: { participantNumber:string; enrollmentNumber: number; currentRole: string };
  trial: Trial; trials: Trial[]; messages: Message[]; profile: { name: string; gift_budget: number };
  aiConfigured: boolean };
const conditionLabel: Record<string,string> = {
  A: "한 개씩 후보 만들기 · 직접 선택", B: "Agent가 후보 3개 구성 · 직접 선택",
  C: "한 개씩 후보 만들기 · Agent 확정", D: "Agent가 후보 3개 구성·확정",
};
const id = () => crypto.randomUUID();

function ProductCard({ product, onOpen, action, disabled }: { product: Product; onOpen: (product: Product) => void;
  action?: { label: string; run: () => void }; disabled?: boolean }) {
  return <article className="study-product">
    <button type="button" className="study-product-main" onClick={() => onOpen(product)}>
      <span className="study-product-image">{product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : "🎁"}</span>
      <span className="study-product-name">{product.name_ko}</span>
      <strong>{Number(product.price_krw).toLocaleString()}원</strong>
      <small>{product.category}</small>
      {product.reason && <span className="study-product-reason">{product.reason}</span>}
      <span className="study-product-link">상품 상세 보기</span>
    </button>
    {action && <button type="button" className="study-product-action" disabled={disabled} onClick={action.run}>{action.label}</button>}
  </article>;
}

export function Experiment({ role }: { role: Role }) {
  const [state,setState] = useState<State|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [draft,setDraft] = useState("");
  const [reason,setReason] = useState("");
  const [chosen,setChosen] = useState("");
  const [code,setCode] = useState("");
  const [detail,setDetail] = useState<Product|null>(null);
  const [pendingCandidate,setPendingCandidate] = useState<PendingCandidate|null>(null);
  const [seconds,setSeconds] = useState(0);
  const [preparationWaitSeconds,setPreparationWaitSeconds] = useState(0);
  const [isVisible,setIsVisible] = useState(true);
  const tabId = useRef("");
  const automated = useRef("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const confirmCandidateButton = useRef<HTMLButtonElement>(null);
  const openAt = useRef(0);
  const detailDwellMs = useRef(0);
  const openedIds = useRef<Record<string,number>>({});
  const reasonStarted = useRef(false);
  const draftStarted = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const reasonTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const viewedTrial = useRef("");
  const comparedTrial = useRef("");
  const markedVisible = useRef("");
  const scriptedSent = useRef<Set<number>>(new Set());
  const viewedPhase = useRef("");
  const activeTrial = useRef("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/experiment/current?role="+role, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "상태를 불러오지 못했습니다.");
    setState(result);
    setSeconds(Math.floor((result.trial.phase_effective_ms ?? 0)/1000));
    if (result.trial.candidates_visible_at || result.trial.phase!=="candidates") setPreparationWaitSeconds(0);
    return result as State;
  },[role]);

  const event = useCallback(async (eventType:string, payload:Record<string,unknown> = {}, target?:string) => {
    const trialId = state?.trial.id;
    if (!trialId) return;
    try { await fetch("/api/experiment/action", { method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({role,trialId,type:"event",eventType,payload,target,key:id(),clientAt:new Date().toISOString()}) }); }
    catch { /* optional telemetry must not block study actions */ }
  },[role,state?.trial.id]);

  const action = useCallback(async (type:string, extra:Record<string,unknown> = {}) => {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/experiment/action", { method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({role,trialId:state.trial.id,type,key:id(),...extra}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "다시 시도해 주세요.");
      if (type==="activate" && !result.accepted) throw new Error("전환 코드가 맞지 않습니다. 연구자에게 확인해 주세요.");
      if ((type==="survey" || type==="skipTimeout") && result.role_complete) {
        window.location.assign("/complete");
        return;
      }
      await refresh();
      if (type==="activate") setCode("");
      return result;
    } catch (cause) {
      if (type==="candidatesVisible") markedVisible.current="";
      setError(cause instanceof Error ? cause.message : "오류가 발생했습니다.");
    }
    finally { setBusy(false); }
  },[busy,refresh,role,state]);

  useEffect(() => { if (pendingCandidate) confirmCandidateButton.current?.focus(); },[pendingCandidate]);

  const openCandidateConfirmation = (product:Product, requestKey:string, slot:number, trialId:string) => {
    if (busy || !state || state.trial.id!==trialId || state.trial.proposal?.request_key!==requestKey) return;
    setPendingCandidate({trialId,requestKey,product,slot});
  };
  const confirmCandidate = async () => {
    const pending=pendingCandidate;
    if (!pending || !state || busy || state.trial.id!==pending.trialId ||
      state.trial.proposal?.request_key!==pending.requestKey) return;
    await event("candidate_confirmation_attempt",{slot:pending.slot},pending.product.source_product_id);
    const result=await action("confirmCandidate",{requestKey:pending.requestKey});
    if (result?.confirmed) setPendingCandidate(null);
  };

  const agentTask = useCallback(async (task:"one"|"batch"|"final", request?:string) => {
    if (!state || busy) return;
    setBusy(true); setError("");
    const key=id();
    try {
      const response = await fetch("/api/experiment/candidate", { method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({role,trialId:state.trial.id,task,key,request}) });
      const result = await response.json();
      if (!response.ok) throw new Error(`${result.error ?? "Agent 작업을 완료하지 못했습니다."}${result.errorRef ? ` (${result.errorRef})` : ""}`);
      if (task==="one" && !result.clarification) { setDraft(""); draftStarted.current=false; }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "오류가 발생했습니다."); }
    finally { setBusy(false); }
  },[busy,refresh,role,state]);

  useEffect(() => {
    tabId.current=sessionStorage.getItem("study-tab-id") || id();
    sessionStorage.setItem("study-tab-id",tabId.current);
    let alive=true;
    refresh().then(() => { if(alive) setError(""); }).catch(cause => { if(alive) setError(cause.message); });
    return () => {alive=false;};
  },[refresh]);

  useEffect(() => {
    const trialId=state?.trial.id;
    if (!trialId || activeTrial.current===trialId) return;
    activeTrial.current=trialId;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (reasonTimer.current) clearTimeout(reasonTimer.current);
    draftTimer.current=null;reasonTimer.current=null;
    setDraft("");setReason("");setChosen("");setCode("");
    setDetail(null);setPendingCandidate(null);setError("");setPreparationWaitSeconds(0);
    draftStarted.current=false;reasonStarted.current=false;
    openedIds.current={};openAt.current=0;detailDwellMs.current=0;
    automated.current="";markedVisible.current="";scriptedSent.current.clear();
  },[state?.trial.id]);

  useEffect(() => {
    if (state?.trial.id && viewedTrial.current!==state.trial.id) {
      viewedTrial.current=state.trial.id;
      void event("screen_view",{phase:state.trial.phase});
      void event("reconnected",{phase:state.trial.phase});
    }
  },[state?.trial.id,event]);

  useEffect(() => {
    const trial=state?.trial;
    if (!trial || viewedPhase.current===trial.id+":"+trial.phase) return;
    viewedPhase.current=trial.id+":"+trial.phase;
    if (trial.phase==="survey") void event("survey_started");
    if (trial.phase==="locked") void event("transition_opened");
  },[state?.trial.id,state?.trial.phase,event]);

  useEffect(() => {
    if (state?.trial.phase==="decision" && comparedTrial.current!==state.trial.id) {
      comparedTrial.current=state.trial.id;
      void event("comparison_opened",{candidate_count:state.trial.candidate_snapshots.length});
    }
  },[state?.trial.id,state?.trial.phase,event]);

  useEffect(() => {
    if (!state || busy || state.trial.phase!=="candidates" || state.trial.candidate_builder!=="agent"
      || state.trial.candidate_snapshots.length!==3 || state.trial.candidates_visible_at
      || markedVisible.current===state.trial.id) return;
    const displayed=role==="giver" || state.messages.some(message=>message.trial_id===state.trial.id &&
      message.kind==="candidate_batch" && Number(message.payload?.offset_ms??0)<=seconds*1000);
    if (!displayed) return;
    markedVisible.current=state.trial.id;
    void action("candidatesVisible");
  },[state,busy,seconds,role,action]);

  useEffect(()=>()=>{if(draftTimer.current)clearTimeout(draftTimer.current);
    if(reasonTimer.current)clearTimeout(reasonTimer.current);},[]);

  useEffect(() => {
    if (!detail) return;
    const updateDwell = () => {
      const active=document.visibilityState==="visible" && document.hasFocus() && navigator.onLine;
      if (active && !openAt.current) openAt.current=Date.now();
      if (!active && openAt.current) { detailDwellMs.current+=Date.now()-openAt.current;openAt.current=0; }
    };
    document.addEventListener("visibilitychange",updateDwell);
    window.addEventListener("focus",updateDwell); window.addEventListener("blur",updateDwell);
    window.addEventListener("online",updateDwell); window.addEventListener("offline",updateDwell);
    return () => {
      document.removeEventListener("visibilitychange",updateDwell);
      window.removeEventListener("focus",updateDwell); window.removeEventListener("blur",updateDwell);
      window.removeEventListener("online",updateDwell); window.removeEventListener("offline",updateDwell);
    };
  },[detail]);

  useEffect(() => {
    if (!state || !["candidates","decision"].includes(state.trial.phase)) return;
    let stopped=false;
    const ping=async () => {
      const active=document.visibilityState==="visible" && document.hasFocus() && navigator.onLine;
      setIsVisible(active);
      try {
        const response=await fetch("/api/experiment/action", {method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({role,trialId:state.trial.id,type:"ping",tabId:tabId.current,sequence:Date.now(),active})});
        const result=await response.json();
        if (!stopped && response.ok) {
          setSeconds(Math.floor(result.effective_ms/1000));
          setPreparationWaitSeconds(result.waiting_for_candidates ? Math.floor((result.preparation_wait_ms??0)/1000) : 0);
          if (result.phase==="timeout") setError("");
          if (result.phase==="timeout" || role==="recipient") await refresh();
        }
      } catch {}
    };
    ping();
    const interval=setInterval(ping,3000);
    const visibility=() => { event(document.visibilityState==="visible"?"tab_visible":"tab_hidden"); ping(); };
    const online=() => { event("connection_restored"); ping(); };
    const offline=() => { event("connection_lost"); ping(); };
    document.addEventListener("visibilitychange",visibility);
    window.addEventListener("focus",visibility); window.addEventListener("blur",visibility);
    window.addEventListener("online",online); window.addEventListener("offline",offline);
    return () => { stopped=true; clearInterval(interval); document.removeEventListener("visibilitychange",visibility);
      window.removeEventListener("focus",visibility); window.removeEventListener("blur",visibility);
      window.removeEventListener("online",online); window.removeEventListener("offline",offline); };
  },[state?.trial.id,state?.trial.phase,role,refresh,event]);

  useEffect(() => {
    if (!state || busy) return;
    const trial=state.trial;
    const key=trial.id+":"+trial.phase+":"+trial.candidate_snapshots.length+":"+Boolean(trial.final_product_id);
    if (automated.current===key) return;
    if (role==="giver" && trial.phase==="candidates" && trial.candidate_builder==="agent" && trial.candidate_snapshots.length===0) {
      automated.current=key; void agentTask("batch");
    }
    if (role==="giver" && trial.phase==="decision" && trial.decision_actor==="agent" && !trial.final_product_id) {
      automated.current=key; void agentTask("final");
    }
    if (role==="recipient" && trial.phase==="decision" && !trial.final_product_id && trial.stimulus_id &&
      state.messages.some(message=>message.trial_id===trial.id && message.kind==="final_selection")) {
      automated.current=key; void action("revealScriptedFinal");
    }
  },[state,busy,agentTask,action,role]);

  const openProduct=(product:Product) => {
    setDetail(product); detailDwellMs.current=0;
    openAt.current=document.visibilityState==="visible" && document.hasFocus() && navigator.onLine ? Date.now() : 0;
    const count=(openedIds.current[product.source_product_id]??0)+1;
    openedIds.current[product.source_product_id]=count;
    void event(count===1?"candidate_opened":"candidate_revisited",{count},product.source_product_id);
  };
  const closeProduct=() => {
    if (!detail) return;
    const durationMs=detailDwellMs.current+(openAt.current?Math.max(0,Date.now()-openAt.current):0);
    openAt.current=0;detailDwellMs.current=0;
    void event("candidate_dwell",{duration_ms:durationMs},detail.source_product_id);
    void event("candidate_closed",{},detail.source_product_id);
    setDetail(null);
  };
  const onDraft=(text:string) => {
    if (!draftStarted.current) {draftStarted.current=true;void event("prompt_started");}
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current=setTimeout(()=>void event("prompt_changed",{text,length:text.length}),650);
    setDraft(text);
  };
  const onReason=(text:string) => {
    if (!reasonStarted.current) {reasonStarted.current=true;void event("reason_started");}
    if (reasonTimer.current) clearTimeout(reasonTimer.current);
    reasonTimer.current=setTimeout(()=>void event("reason_changed",{text,length:text.length}),650);
    setReason(text);
  };
  const submitPrompt=async () => {
    if(draftTimer.current){clearTimeout(draftTimer.current);draftTimer.current=null;}
    await event("prompt_changed",{text:draft,length:draft.length});
    await event("prompt_submitted",{text:draft,slot:(state?.trial.candidate_snapshots.length??0)+1});
    await agentTask("one",draft);
  };
  const finalizeHuman=async () => {
    if(reasonTimer.current){clearTimeout(reasonTimer.current);reasonTimer.current=null;}
    await event("reason_changed",{text:reason,length:reason.length});
    await event("reason_submitted",{length:reason.trim().length});
    await action("finalizeHuman",{productId:chosen,reason});
  };
  const trial=state?.trial;
  const visibleTrials=state?.trials ?? [];
  const shownMessages=state?.messages.filter(message => {
    const owner=visibleTrials.find(item=>item.id===message.trial_id);
    if (!owner) return false;
    if (owner.id!==trial?.id || role!=="recipient" || ["complete","skipped"].includes(owner.phase)) return true;
    if (message.phase==="candidates" && trial.phase!=="locked") return true;
    if (message.phase==="decision" && trial.phase==="candidates") return false;
    const offset=Number(message.payload?.offset_ms??0);
    return offset<=seconds*1000 || trial.phase==="survey";
  }) ?? [];
  useEffect(() => {
    if (!trial || role!=="recipient") return;
    for (const message of shownMessages) {
      if (message.trial_id!==trial.id || message.origin!=="scripted" || scriptedSent.current.has(message.id)) continue;
      scriptedSent.current.add(message.id);
      void fetch("/api/experiment/action",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({role,trialId:trial.id,type:"scriptedShown",messageId:message.id})})
        .then(response=>{if(!response.ok) scriptedSent.current.delete(message.id);})
        .catch(()=>scriptedSent.current.delete(message.id));
    }
  },[shownMessages,trial?.id,role]);
  const currentCount=trial?.candidate_snapshots.length ?? 0;
  const phaseTitle=trial?.phase==="candidates"?"1단계 · 후보 만들기":trial?.phase==="decision"?"2단계 · 최종 선택":
    trial?.phase==="survey"?"조건 설문":trial?.phase==="timeout"?"시간 초과 · 미완료 기록":"조건 전환";
  const minimumSeconds=MINIMUM_PHASE_MS/1000;
  const maximumSeconds=MAXIMUM_PHASE_MS/1000;
  const remaining=Math.max(0,maximumSeconds-seconds);
  const minReady=seconds>=minimumSeconds;
  const awaitingCandidates=trial?.phase==="candidates" && trial.candidate_builder==="agent" && !trial.candidates_visible_at;
  const selectedProduct=trial?.candidate_snapshots.find(product=>product.source_product_id===trial.final_product_id);
  return <main className="study-experience">
    <aside className="study-side">
      <h1>🎁 선물 선택 연구</h1>
      <p>{role==="giver"?"선물 주는 사람 · P01":"선물 받는 사람 · P02"} · 참가번호 {state?.person.participantNumber??"…"}</p>
      <section><h2>진행 안내</h2><p>{role==="giver"?`종이 자료 ${trial?.profile_code??"…"} · ${state?.profile.name??"…"}`:"친구 A · 당신의 생일 선물"}</p><p>{role==="giver"?"종이로 받은 선물 대상 자료를 읽어 주세요. 상품 후보와 Agent 대화는 오른쪽 화면에서 진행합니다.":"네 상황은 같은 친구가 같은 생일 선물을 준비하는 장면입니다. 선물을 고르는 방식만 달라집니다. 화면 속 친구 A의 행동은 연구자가 구성한 시나리오입니다."}</p></section>
      <section><h2>현재 조건</h2><strong>{trial?.condition??"…"} · {trial ? conditionLabel[trial.condition] : ""}</strong><p>{trial?.order_position??"…"} / 4조건</p></section>
      <section><h2>시간 규칙</h2><p>한 조건의 후보 3개는 하나의 후보 단계에서 만듭니다. 후보 한 개마다 시간이 새로 시작하지 않습니다. 후보 단계와 최종 단계에 각각 유효 노출 {minimumSeconds}–{maximumSeconds}초를 적용합니다. 시간초과 시 미완료로 기록하고 다음 조건으로 진행할 수 있습니다.</p></section>
      <a href="/start">친구 화면으로</a>
    </aside>
    <div className={`study-chat-phone ${trial ? `study-condition-${trial.condition}` : ""}`}>
      <div className="study-chat-screen">
        <header className="study-chat-header">
          <div className="study-chat-status"><span>11:03</span><span>▥ ● ▰</span></div>
          <div className="study-chat-heading"><span aria-hidden="true">🎁</span><div><strong>선물 상담</strong><small>{phaseTitle}</small></div><span className="study-condition-tag">조건 {trial?.condition??"…"} · {trial?.order_position??"…"}/4</span></div>
          {trial && ["candidates","decision"].includes(trial.phase) && <div className="study-clock" aria-live="polite"><span>{awaitingCandidates?`후보 준비 중 · 상품 3개가 표시되면 ${minimumSeconds}초 시작`:`${trial.phase==="candidates"?"후보 3개 전체 단계":"최종 선택 단계"} · ${!isVisible?"일시정지":minReady?"최소 확인 완료":`${minimumSeconds-seconds}초 후 다음 단계 가능`}`}</span><strong>{awaitingCandidates?`준비 제한 ${Math.max(0,maximumSeconds-preparationWaitSeconds)}초`: `${remaining}초 남음`}</strong><div><i style={{width:awaitingCandidates?"0%":`${Math.min(100,seconds/minimumSeconds*100)}%`}} /></div></div>}
        </header>
        <div className="study-chat-scroll" key={trial?.id}>
          {!state && <p className="study-chat-notice">연구 상태를 불러오는 중입니다.</p>}
          {state && <div className="study-chat-divider">{role==="giver"?`종이 자료 ${trial?.profile_code} · ${state.profile.name} 확인 · 예산 ${state.profile.gift_budget.toLocaleString()}원`:"당신의 생일 · 친구 A · 네 상황에서 같은 선물"}</div>}
          {visibleTrials.map(item => <div key={item.id}>
            <div className="study-chat-divider">조건 {item.condition} 시작 · {conditionLabel[item.condition]}</div>
            <div className="study-chat-divider is-phase">1단계 · 후보 만들기</div>
            {shownMessages.filter(message=>message.trial_id===item.id && message.phase==="candidates").map(message=>
              <div key={message.id} className={`study-bubble ${message.speaker==="participant"||message.speaker==="scripted_giver"?"from-giver":"from-agent"}`}>
                <b>{message.speaker==="participant"||message.speaker==="scripted_giver"?"선물 주는 사람":"Agent"}{message.origin==="scripted"?" · 구성된 시나리오":""}</b>
                <p>{message.content}</p>
                {message.kind==="candidate_confirmed" && message.payload?.product &&
                  <p className="study-basket-confirmation">✓ {message.payload.product.name_ko}이(가) 후보에 담겼습니다.</p>}
                {message.kind==="candidate_proposal" && message.payload?.product && <ProductCard product={message.payload.product} onOpen={openProduct}
                  action={item.id===trial?.id && item.phase==="candidates" && role==="giver" &&
                    item.candidate_builder==="human" && item.proposal?.request_key===message.payload?.request_key
                    ? {label:`후보 ${currentCount+1}에 담기`,run:()=>openCandidateConfirmation(message.payload.product,item.proposal!.request_key,currentCount+1,item.id)}
                    : undefined} disabled={busy} />}
                {message.kind==="candidate_batch" && <div className="study-product-grid">{(message.payload?.candidates??[]).map((product:Product)=><ProductCard key={product.source_product_id} product={product} onOpen={openProduct} />)}</div>}
              </div>)}
            {item.id===trial?.id && item.phase==="candidates" && <>
              {role==="giver" && item.candidate_builder==="human" && <div className="study-chat-control">
                <h3>후보 {Math.min(3,currentCount+1)} / 3</h3>
                <div className="study-basket-status" aria-live="polite"><strong>담긴 후보 {item.candidate_snapshots.length}/3</strong>
                  {item.candidate_snapshots.length>0 && <ol>{item.candidate_snapshots.map(product=><li key={product.source_product_id}>{product.name_ko}</li>)}</ol>}</div>
                {item.proposal ? <p>상품 카드에서 ‘후보에 담기’를 누른 뒤 확인해 주세요. 다른 상품을 원하면 요청을 고쳐 다시 보내세요.</p>
                : currentCount<3 ? <p>이번 후보에서 찾고 싶은 상품이나 사용 상황을 자유롭게 적어 주세요.</p> : <p>후보 세 개를 확정했습니다.</p>}
                {currentCount<3 && <form onSubmit={e=>{e.preventDefault();void submitPrompt();}}>
                  <textarea aria-label="이번 후보에 대한 요청" value={draft} onChange={e=>onDraft(e.target.value)}
                    placeholder="찾고 싶은 상품이나 사용 상황을 자유롭게 적어 주세요." />
                  <button type="submit" disabled={busy||!draft.trim()}>후보 한 개 요청</button></form>}
              </div>}
              {role==="giver" && item.candidate_builder==="agent" && currentCount===0 && <div className="study-chat-control">
                <p>Agent가 연구용으로 저장된 상품 자료에서 후보 세 개를 준비합니다. 상품이 표시되면 확인시간이 시작됩니다.</p><button disabled={busy} onClick={()=>{void event("retry",{task:"batch"});void agentTask("batch");}}>후보 준비 다시 시도</button></div>}
              {role==="recipient" && <div className="study-chat-control"><p>연구자가 구성한 대화와 후보를 관찰해 주세요. 화면 속 요청과 클릭은 당신의 행동으로 기록되지 않습니다.</p></div>}
              {role==="giver" && item.candidate_builder==="human" && currentCount===3 &&
                <div className="study-chat-control"><div className="study-product-grid">{item.candidate_snapshots.map(product=><ProductCard key={product.source_product_id} product={product} onOpen={openProduct} />)}</div></div>}
            </>}
            {(["decision","survey","complete"].includes(item.phase) || ["timeout","skipped"].includes(item.phase) && item.timeout_phase==="decision") && <div className="study-chat-divider is-phase">2단계 · 최종 선택</div>}
            {item.candidate_snapshots.length===3 && (["decision","survey","complete"].includes(item.phase) || ["timeout","skipped"].includes(item.phase) && item.timeout_phase==="decision") && <div className="study-chat-control">
              <h3>세 후보 비교</h3><div className="study-comparison-scroll"><table className="study-comparison">
                <thead><tr><th>확인 항목</th>{item.candidate_snapshots.map(product=><th key={product.source_product_id}>{product.name_ko}</th>)}</tr></thead>
                <tbody><tr><th>연구용 가격</th>{item.candidate_snapshots.map(product=><td key={product.source_product_id}>{Number(product.price_krw).toLocaleString()}원</td>)}</tr>
                  <tr><th>상품 종류</th>{item.candidate_snapshots.map(product=><td key={product.source_product_id}>{product.category}</td>)}</tr>
                  <tr><th>원본명</th>{item.candidate_snapshots.map(product=><td key={product.source_product_id}>{product.name_original}</td>)}</tr></tbody>
              </table></div><p>확인된 상품 기록만 표시합니다. 상세 설명은 상품 카드를 눌러 확인할 수 있습니다.</p>
            </div>}
            {shownMessages.filter(message=>message.trial_id===item.id && message.phase==="decision").map(message=>
              <div key={message.id} className={`study-bubble ${message.speaker==="participant"||message.speaker==="scripted_giver"?"from-giver":"from-agent"}`}>
                <b>{message.speaker==="participant"||message.speaker==="scripted_giver"?"선물 주는 사람":"Agent"}{message.origin==="scripted"?" · 구성된 시나리오":""}</b><p>{message.content}</p>
              </div>)}
            {item.id===trial?.id && item.phase==="decision" && role==="giver" && item.decision_actor==="human" && !item.final_product_id &&
              <div className="study-chat-control"><h3>세 후보 중 하나를 선택해 주세요</h3>
                <div className="study-product-grid">{item.candidate_snapshots.map(product=><ProductCard key={product.source_product_id}
                  product={product} onOpen={openProduct} action={{label:chosen===product.source_product_id?"선택됨":"이 상품 선택",run:()=>{
                    void event(chosen?"selection_changed":"selection_draft",{from:chosen||null,to:product.source_product_id});
                    setChosen(product.source_product_id);}}} />)}</div>
                <label>다른 두 후보가 아닌 이 상품을 고른 이유
                  <textarea value={reason} onChange={e=>onReason(e.target.value)} placeholder="직접 이유를 작성해 주세요." /></label>
                <button disabled={busy||!chosen||reason.trim().length<20||!/(다른|나머지|두 후보|보다|비해|대비|셋 중|세 후보|가장)/.test(reason)}
                  onClick={()=>void finalizeHuman()}>최종 선택 확정</button>
              </div>}
            {item.id===trial?.id && item.phase==="decision" && role==="giver" && item.decision_actor==="agent" && !item.final_product_id &&
              <div className="study-chat-control"><p>Agent가 현재 세 후보 중 하나를 추천·확정합니다.</p><button disabled={busy} onClick={()=>{void event("retry",{task:"final"});void agentTask("final");}}>Agent 결과 다시 시도</button></div>}
            {item.final_product_id && <div className="study-chat-control study-final-card"><h3>{item.final_actor==="agent"?"Agent가 선택한 최종 선물":"선물 주는 사람이 선택한 최종 선물"}</h3><strong>{item.candidate_snapshots.find(p=>p.source_product_id===item.final_product_id)?.name_ko}</strong><p>{item.final_reason}</p></div>}
            {item.phase==="complete" && <div className="study-chat-divider">조건 {item.condition} 완료</div>}
            {item.phase==="skipped" && <div className="study-chat-divider">조건 {item.condition} · 시간초과로 미완료</div>}
          </div>)}
          <div ref={chatEnd} />
        </div>
        <footer className="study-chat-footer">
          {error && <p className="study-chat-error" role="alert">{error}</p>}
          {trial?.phase==="locked" && <div className="study-footer-task"><label>연구자에게 받은 전환 코드
            <input type="password" inputMode="numeric" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} placeholder="코드 입력" /></label>
            <button disabled={busy||!code} onClick={()=>void action("activate",{code})}>조건 {trial.condition} 시작</button></div>}
          {trial?.phase==="candidates" && <div className="study-footer-task"><span>{awaitingCandidates?`후보 ${currentCount}/3 · 상품 표시 대기 (표시 후 ${minimumSeconds}초 확인)`:`후보 ${currentCount}/3 · 전체 후보 단계 유효 ${seconds}/${minimumSeconds}초 이상`}</span>
            {role==="giver" && trial.candidate_builder==="human" && trial.proposal &&
              <button disabled={busy} onClick={()=>openCandidateConfirmation(trial.proposal!.product,trial.proposal!.request_key,currentCount+1,trial.id)}>제안된 상품을 후보 {currentCount+1}에 담기</button>}
            <button disabled={busy||!minReady||currentCount!==3} onClick={()=>void action("advance")}>최종 단계로 이동</button></div>}
          {trial?.phase==="decision" && <div className="study-footer-task"><span>결과 확인 · 유효 {seconds}/{minimumSeconds}초 이상</span>
            <button disabled={busy||!minReady||!trial.final_product_id} onClick={()=>void action("advance")}>종이 설문으로 이동</button></div>}
          {trial?.phase==="survey" && <div className="study-footer-task"><span>종이 설문을 작성한 뒤 연구자에게 제출해 주세요.</span>
            <button disabled={busy} onClick={()=>void action("survey")}>종이 설문 완료 확인</button></div>}
          {trial?.phase==="timeout" && <div className="study-footer-task"><strong>시간 초과 · 미완료</strong><span>현재까지의 요청과 상품은 저장됩니다. 비어 있는 선택은 그대로 남기고 다음 조건으로 진행할 수 있습니다.</span>
            <button disabled={busy} onClick={()=>void action("skipTimeout")}>미완료로 기록하고 다음 조건</button></div>}
          {trial?.phase==="complete" && <p>이 역할을 마쳤습니다. 연구자에게 알려 주세요.</p>}
          <button className="study-withdraw" onClick={()=>void action("withdraw")}>연구 참여 중단</button>
        </footer>
      </div>
    </div>
    {pendingCandidate && trial?.id===pendingCandidate.trialId && trial.proposal?.request_key===pendingCandidate.requestKey &&
      <div className="study-confirm-overlay" role="presentation">
        <div className="study-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="study-confirm-title" onKeyDown={e=>{if(e.key==="Escape")setPendingCandidate(null);}}>
          <h2 id="study-confirm-title">이 상품을 후보에 담으시겠습니까?</h2>
          <p><strong>{pendingCandidate.product.name_ko}</strong>을(를) 후보 {pendingCandidate.slot}/3에 담습니다.</p>
          <p>담은 뒤에는 다음 후보를 요청할 수 있습니다. 최종 선물은 세 후보를 모은 뒤 결정합니다.</p>
          <div className="study-confirm-actions"><button type="button" className="study-confirm-cancel" disabled={busy} onClick={()=>setPendingCandidate(null)}>아니요, 다시 보기</button>
            <button type="button" ref={confirmCandidateButton} disabled={busy} onClick={()=>void confirmCandidate()}>{busy?"담는 중…":`네, 후보 ${pendingCandidate.slot}에 담기`}</button></div>
          {error && <p className="study-chat-error" role="alert">{error}</p>}
        </div>
      </div>}
    {detail && <div className="study-detail-overlay" role="dialog" aria-modal="true" aria-label={detail.name_ko}>
      <div className="study-detail"><button type="button" className="study-detail-close" onClick={closeProduct}>닫기 ×</button>
        {detail.image_url && <img src={detail.image_url} alt="" />}
        <h2>{detail.name_ko}</h2><strong>{Number(detail.price_krw).toLocaleString()}원</strong>
        <p>{detail.name_original}</p><p>{detail.description_original}</p>
        {detail.source_url && <a href={detail.source_url} target="_blank" rel="noreferrer">원본 상품 정보</a>}
        <small>상품 기록 또는 판매 페이지에서 확인한 가격을 연구용 고정 환율로 환산했습니다. 실제 결제가는 다를 수 있습니다.</small>
      </div></div>}
  </main>;
}
