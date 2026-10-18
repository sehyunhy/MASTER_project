"use client";
import { useState } from "react";
import { ROLE_CODES } from "@/lib/study/config";

type Role = "giver" | "recipient";
type Screen = "friends" | "profile";

export function ParticipantStart() {
  const [role, setRole] = useState<Role>("giver");
  const [screen, setScreen] = useState<Screen>("friends");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newParticipant, setNewParticipant] = useState(false);
  const [canStartNew, setCanStartNew] = useState(false);
  async function enterExperiment(startNew = newParticipant) {
    if (busy) return;
    setBusy(true); setError(""); setCanStartNew(false);
    try {
      const browserKey = startNew
        ? sessionStorage.getItem("study-pending-new-browser-key") || crypto.randomUUID()
        : localStorage.getItem("study-browser-key") || crypto.randomUUID();
      if (startNew) sessionStorage.setItem("study-pending-new-browser-key",browserKey);
      else localStorage.setItem("study-browser-key",browserKey);
      const response = await fetch("/api/participant/start", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, browserKey, newParticipant:startNew }),
      });
      const result = await response.json();
      if (!response.ok) {
        setCanStartNew(Boolean(result.canStartNew));
        throw new Error(result.error ?? "참가를 시작하지 못했습니다.");
      }
      localStorage.setItem("study-browser-key",browserKey);
      if (startNew) sessionStorage.removeItem("study-pending-new-browser-key");
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
        <button type="button" aria-pressed={role === "giver"} className={role === "giver" ? "is-active" : ""} onClick={() => { if(role!=="giver") sessionStorage.removeItem("study-pending-new-browser-key"); setRole("giver"); setScreen("friends"); setError(""); setCanStartNew(false); }}>{ROLE_CODES.giver} · 선물 주는 사람</button>
        <button type="button" aria-pressed={role === "recipient"} className={role === "recipient" ? "is-active" : ""} onClick={() => { if(role!=="recipient") sessionStorage.removeItem("study-pending-new-browser-key"); setRole("recipient"); setScreen("friends"); setError(""); setCanStartNew(false); }}>{ROLE_CODES.recipient} · 선물 받는 사람</button>
      </div>
      <p className="study-entry-help">P01과 P02는 역할 표시입니다. 참가자 번호나 관계의 친밀도를 뜻하지 않습니다. 참가자 ID는 시작할 때 자동으로 발급됩니다.</p>
      <div className="study-entry-divider" />
      <dl className="study-entry-facts"><div><dt>현재 역할</dt><dd>{roleLabel}</dd></div><div><dt>현재 화면</dt><dd>{screen === "friends" ? "친구 목록" : "선물 받을 사람 프로필"}</dd></div><div><dt>실험 조건</dt><dd>네 조건 모두 체험</dd></div></dl>
      <h2>진행 순서</h2>
      <ol className="study-entry-steps"><li>선물 받을 사람을 누르세요.</li><li>종이 자료를 읽고 선물하기를 누르세요.</li><li>배정된 네 조건을 차례로 체험하세요.</li></ol>
      <p className="study-entry-help">각 조건의 후보 단계와 최종 단계는 각각 유효 체험시간 1–3분입니다. 설문과 조건 전환 시간은 별도입니다.</p>
      <button type="button" className="study-next-person" aria-pressed={newParticipant}
        onClick={() => { if(newParticipant) sessionStorage.removeItem("study-pending-new-browser-key"); setNewParticipant(value => !value); setError(""); setCanStartNew(false); }}>
        {newParticipant ? "새 참가자 시작 선택됨 · 취소" : "새 참가자로 시작"}
      </button>
      {newParticipant && <p className="study-entry-help">새 참가자에게 별도 ID를 발급합니다. 이전 참가자가 진행 중이면 기록을 보존하고 미완료로 종료합니다.</p>}
      {error && <p className="study-entry-error" role="alert">{error}</p>}
      {canStartNew && <button type="button" className="study-next-person" disabled={busy}
        onClick={() => { setNewParticipant(true); void enterExperiment(true); }}>새 참가자 {ROLE_CODES[role]}로 시작</button>}
    </aside>
    <section className="study-phone-area" aria-label="실험 시작 화면">
      <p className="study-demo-caption">친구 선택 → 프로필 확인 → 선물하기</p>
      <div className="study-phone-frame"><div className={`study-phone-screen ${screen === "friends" ? "is-friends" : "is-profile"}`}>
        <div className="study-phone-status"><span>11:03</span><span aria-hidden="true">▥ ● ▰</span></div>
        {screen === "friends" ? <>
          <header className="study-friends-header"><div><span className="study-me-avatar">나</span><strong>내 프로필</strong></div><span className="study-friends-icons" aria-hidden="true">⌕ ♙ ⚙</span></header>
          <div className="study-friends-tabs"><span className="is-active">친구</span><span>소식</span></div>
          <div className="study-friends-list"><p>선물할 사람</p><button type="button" className="study-friend-row" onClick={() => setScreen("profile")}><span className="study-friend-avatar">🎂</span><span><strong>선물 받을 사람</strong><small>{role === "giver" ? "생일 선물을 고르러 가기" : "선물 선택 과정을 관찰하기"}</small></span><span className="study-friend-arrow" aria-hidden="true">›</span></button><p className="study-friend-hint">종이로 제공된 프로필을 확인한 뒤 진행합니다.</p></div>
          <nav className="study-phone-nav" aria-label="화면 장식"><span className="is-active">●</span><span>☷</span><span>◎</span><span>▣</span><span>•••</span></nav>
        </> : <>
          <header className="study-profile-top"><button type="button" onClick={() => setScreen("friends")} aria-label="친구 목록으로 돌아가기">×</button><span>선물 받을 사람</span><span aria-hidden="true">♧</span></header>
          <div className="study-profile-center"><div className="study-profile-avatar">🎂</div><h2>선물 받을 사람</h2><p>종이 자극물의 인물과 선물 상황을 확인해 주세요.</p></div>
          <div className="study-profile-actions"><button type="button" disabled={busy} onClick={() => void enterExperiment()}><span aria-hidden="true">🎁</span>{busy ? "준비 중…" : role === "giver" ? "선물하기" : "관찰 시작"}</button></div>
          <section className="study-profile-paper"><strong>연구 안내</strong><p>{role === "giver" ? "선물 받을 사람의 정보는 종이 자료를 기준으로 합니다. 앱에서는 실제 상품 후보와 Agent와의 대화를 확인합니다." : "연구자가 구성하고 검토한 선택 과정을 관찰합니다. 화면 속 선물 주는 사람의 행동은 당신의 행동으로 기록되지 않습니다."}</p></section>
        </>}
      </div></div>
      <p className="study-demo-caption">{screen === "friends" ? "선물 받을 사람을 눌러주세요." : "종이 자료를 읽은 뒤 선물하기를 눌러주세요."}</p>
    </section>
  </main>;
}
