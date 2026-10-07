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
      window.location.assign("/training");
    } catch (err) { setError(err instanceof Error ? err.message : "오류가 발생했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="panel" style={{ maxWidth: 600, margin: "55px auto" }}><p className="eyebrow">참가자 등록</p><h1 className="title">연구를 시작합니다</h1><p className="body">연구자가 안내한 참가자 코드를 입력해 주세요.</p><form onSubmit={submit}><label>참가자 코드<input className="field" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="P001" required pattern="P[0-9]{3}" /></label><label>참여 방식<select className="field" value={role} onChange={e => setRole(e.target.value)}><option value="giver">선물 주는 사람</option><option value="recipient">선물 받는 사람</option></select></label>{error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}<button className="button" disabled={busy}>{busy ? "확인 중…" : "계속"}</button></form></div>;
}
