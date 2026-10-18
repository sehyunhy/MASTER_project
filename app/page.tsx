import Link from "next/link";
export default function Home() {
  return <main className="shell"><div className="panel" style={{ marginTop: 70 }}><p className="eyebrow">연구 참여 안내</p><h1 className="title">선물 선택 연구</h1><p className="body">안내받은 역할을 선택한 뒤 친구 화면에서 선물하기를 시작해 주세요. 참가자 ID는 자동으로 만들어집니다.</p><Link className="button" href="/start">연구 시작</Link></div></main>;
}
