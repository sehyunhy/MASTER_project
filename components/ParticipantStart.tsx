"use client";
import { useState } from "react";
import { MAXIMUM_PHASE_MS, MINIMUM_PHASE_MS, ROLE_CODES } from "@/lib/study/config";
import { RECIPIENT_STORY } from "@/lib/study/recipient-context";
import { counterpartId, validParticipantId } from "@/lib/study/participant-id";

type Role = "giver" | "recipient";
type Screen = "friends" | "profile";

export function ParticipantStart() {
  const [role, setRole] = useState<Role>("giver");
  const [screen, setScreen] = useState<Screen>("friends");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [participantNumber, setParticipantNumber] = useState("");
  async function enterExperiment() {
    if (busy) return;
    const number=participantNumber.trim().toUpperCase();
    if (!validParticipantId(number,role)) {
      setError(role==="giver"?"선물 주는 사람 ID는 K02처럼 K와 짝수 번호를 입력해 주세요.":"선물 받는 사람 ID는 K01처럼 K와 홀수 번호를 입력해 주세요.");
      return;
    }
    setBusy(true); setError("");
    try {
      const browserKey = localStorage.getItem("study-browser-key") || crypto.randomUUID();
      const response = await fetch("/api/participant/start", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, browserKey,participantNumber:number }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "참가를 시작하지 못했습니다.");
      localStorage.setItem("study-browser-key",result.browserKey);
      localStorage.setItem("study-participant-number",number);
      sessionStorage.setItem("participantId", result.participant.id);
      sessionStorage.setItem("role", role);
      window.location.assign(role === "giver" ? "/experiment/giver" : "/experiment/recipient");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "오류가 발생했습니다.");
      setBusy(false);
    }
  }
  const roleLabel = role === "giver" ? "선물 주는 사람" : "선물 받는 사람";
  return <main className="study-entry">
    <aside className="study-entry-guide" aria-label="연구 진행 안내">
      <div className="study-entry-heading"><span aria-hidden="true">🎁</span><div><h1>선물 선택 연구</h1><p>친구 화면에서 시작하는 선물 선택</p></div></div>
      <div className="study-entry-divider" />
      <h2>진행할 역할</h2>
      <div className="study-role-buttons" role="group" aria-label="역할 선택">
        <button type="button" aria-pressed={role === "giver"} className={role === "giver" ? "is-active" : ""} onClick={() => { setRole("giver"); setScreen("friends"); setError(""); }}>{ROLE_CODES.giver} · 선물 주는 사람</button>
        <button type="button" aria-pressed={role === "recipient"} className={role === "recipient" ? "is-active" : ""} onClick={() => { setRole("recipient"); setScreen("friends"); setError(""); }}>{ROLE_CODES.recipient} · 선물 받는 사람</button>
      </div>
      <p className="study-entry-help">한 사람의 두 역할은 연속된 ID로 연결됩니다. 선물 받는 사람은 홀수(K01), 선물 주는 사람은 다음 짝수(K02)를 입력합니다. 위 P01·P02는 역할 코드입니다.</p>
      <label className="study-participant-number">참가자 ID
        <input className="field" type="text" autoComplete="off" maxLength={9}
          placeholder={role==="giver"?"예: K02":"예: K01"} value={participantNumber} aria-label="참가자 ID, K와 번호"
          onChange={event=>{setParticipantNumber(event.target.value.toUpperCase());setError("");}} />
      </label>
      {validParticipantId(participantNumber.trim(),role) && <p className="study-entry-help">같은 사람의 {role==="giver"?"선물 받는 사람":"선물 주는 사람"} ID: {counterpartId(participantNumber.trim(),role)}</p>}
      <div className="study-entry-divider" />
      <dl className="study-entry-facts"><div><dt>현재 역할</dt><dd>{roleLabel}</dd></div><div><dt>현재 화면</dt><dd>{screen === "friends" ? "친구 목록" : "선물 받을 사람 프로필"}</dd></div><div><dt>실험 조건</dt><dd>네 조건 모두 체험</dd></div></dl>
      <h2>진행 순서</h2>
      <ol className="study-entry-steps"><li>{role === "giver" ? "선물 받을 사람" : "친구 A"}을(를) 누르세요.</li><li>{role === "giver" ? "종이 자료를 읽고 선물하기를 누르세요." : "생일 선물 이야기를 읽고 관찰을 시작하세요."}</li><li>배정된 네 조건을 차례로 체험하세요.</li></ol>
      <p className="study-entry-help">각 조건의 후보 단계와 최종 단계는 각각 유효 체험시간 {MINIMUM_PHASE_MS/1000}–{MAXIMUM_PHASE_MS/1000}초입니다. 설문과 조건 전환 시간은 별도입니다.</p>
      {error && <p className="study-entry-error" role="alert">{error}</p>}
    </aside>
    <section className="study-phone-area" aria-label="실험 시작 화면">
      <p className="study-demo-caption">친구 선택 → 프로필 확인 → 선물하기</p>
      <div className="study-phone-frame"><div className={`study-phone-screen ${screen === "friends" ? "is-friends" : "is-profile"}`}>
        <div className="study-phone-status"><span>11:03</span><span aria-hidden="true">▥ ● ▰</span></div>
        {screen === "friends" ? <>
          <header className="study-friends-header"><div><span className="study-me-avatar">나</span><strong>내 프로필</strong></div><span className="study-friends-icons" aria-hidden="true">⌕ ♙ ⚙</span></header>
          <div className="study-friends-tabs"><span className="is-active">친구</span><span>소식</span></div>
          <div className="study-friends-list"><p>{role === "giver" ? "선물할 사람" : "생일 선물 이야기"}</p><button type="button" className="study-friend-row" onClick={() => setScreen("profile")}><span className="study-friend-avatar">🎂</span><span><strong>{role === "giver" ? "선물 받을 사람" : "친구 A"}</strong><small>{role === "giver" ? "생일 선물을 고르러 가기" : "선물 선택 과정을 관찰하기"}</small></span><span className="study-friend-arrow" aria-hidden="true">›</span></button><p className="study-friend-hint">{role === "giver" ? "종이로 제공된 프로필을 확인한 뒤 진행합니다." : "같은 친구와 같은 생일 선물을 네 가지 방식으로 살펴봅니다."}</p></div>
          <nav className="study-phone-nav" aria-label="화면 장식"><span className="is-active">●</span><span>☷</span><span>◎</span><span>▣</span><span>•••</span></nav>
        </> : <>
          <header className="study-profile-top"><button type="button" onClick={() => setScreen("friends")} aria-label="친구 목록으로 돌아가기">×</button><span>선물 받을 사람</span><span aria-hidden="true">♧</span></header>
          <div className="study-profile-center"><div className="study-profile-avatar">🎂</div><h2>{role === "giver" ? "선물 받을 사람" : "친구 A"}</h2><p>{role === "giver" ? "종이 자극물의 인물과 선물 상황을 확인해 주세요." : "오늘은 당신의 생일입니다. 친구 A가 준비한 선물을 살펴보세요."}</p></div>
          <div className="study-profile-actions"><button type="button" disabled={busy} onClick={() => void enterExperiment()}><span aria-hidden="true">🎁</span>{busy ? "준비 중…" : role === "giver" ? "선물하기" : "관찰 시작"}</button></div>
          <section className="study-profile-paper"><strong>{role === "giver" ? "연구 안내" : "당신의 생일 선물"}</strong>{role === "giver" ? <p>선물 받을 사람의 정보는 종이 자료를 기준으로 합니다. 앱에서는 실제 상품 후보와 Agent와의 대화를 확인합니다.</p> : <><p className="study-recipient-story">{RECIPIENT_STORY}</p><p>화면 속 친구 A의 선택 과정은 연구자가 구성한 시나리오입니다. 당신의 실제 행동과 구분해 기록합니다.</p></>}</section>
        </>}
      </div></div>
      <p className="study-demo-caption">{screen === "friends" ? `${role === "giver" ? "선물 받을 사람" : "친구 A"}을(를) 눌러주세요.` : role === "giver" ? "종이 자료를 읽은 뒤 선물하기를 눌러주세요." : "생일 선물 이야기를 읽은 뒤 관찰 시작을 눌러주세요."}</p>
    </section>
  </main>;
}
