import Link from "next/link";
export default function Home() {
  return <main className="shell"><div className="panel" style={{ marginTop: 70 }}><p className="eyebrow">연구 참여 안내</p><h1 className="title">선물 선택 연구</h1><p className="body">참여자 코드를 입력하고 안내에 따라 연구를 진행해 주세요. 모든 단계는 같은 기기에서 이어서 진행할 수 있습니다.</p><Link className="button" href="/start">연구 시작</Link></div></main>;
}
