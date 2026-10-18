"use client";
import { useState } from "react";

export function ParticipantStart() {
  const [code, setCode] = useState("");
  const [role, setRole] = useState("giver");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/participant/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantCode: code, role }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error ?? "참가자 등록에 실패했습니다.");
      sessionStorage.setItem("participantId", json.participant.id);
      sessionStorage.setItem("role", role);
      window.location.assign(role === "giver" ? "/experiment/giver" : "/experiment/recipient");
    } catch (err) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="panel" style={{ maxWidth: 600, margin: "55px auto" }}><p className="eyebrow">선물 선택 연구</p><h1 className="title">연구를 시작합니다</h1><p className="body">연구자에게 받은 참가자 코드(N001–N030)를 입력하고 안내받은 역할을 선택해 주세요. 두 역할은 서로 다른 세션과 응답으로 저장됩니다.</p><p className="body">이 역할에서는 네 조건을 차례로 체험합니다. 조건마다 후보 만들기와 비교·최종 결정, 두 구간을 각각 최소 1분·최대 3분 진행합니다. 역할당 체험 시간은 8–24분이며, 설문과 조건 전환 시간은 별도입니다.</p><form onSubmit={submit}><label>참가자 코드<input className="field" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="N001" required pattern="N[0-9]{3}" /></label><label>현재 역할<select className="field" value={role} onChange={e => setRole(e.target.value)}><option value="giver">선물 주는 사람</option><option value="recipient">선물 받는 사람</option></select></label>{error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}<button className="button" disabled={busy}>{busy ? "확인 중…" : "계속"}</button></form></div>;
}
