// A local illustration for a fictional study product; no seller image or URL lookup.
export function simulatedProductImage(category: string): string {
  const kind=/컵|머그|커피|차|텀블러/.test(category)?"cup":
    /책|노트|다이어리|문구/.test(category)?"book":
    /크림|로션|세럼|향|바디|스킨/.test(category)?"bottle":"gift";
  const art=kind==="cup"?'<path d="M100 86h105v93a40 40 0 0 1-40 40h-25a40 40 0 0 1-40-40z" fill="#fff" stroke="#4b638c" stroke-width="8"/><path d="M205 103h17a30 30 0 0 1 0 60h-17" fill="none" stroke="#4b638c" stroke-width="8"/>':
    kind==="book"?'<rect x="100" y="65" width="120" height="170" rx="9" fill="#fff" stroke="#4b638c" stroke-width="8"/><path d="M127 93h66M127 115h66M127 137h45" stroke="#83a3d6" stroke-width="7"/>':
    kind==="bottle"?'<rect x="125" y="83" width="75" height="145" rx="17" fill="#fff" stroke="#4b638c" stroke-width="8"/><rect x="139" y="59" width="47" height="27" rx="5" fill="#83a3d6"/><path d="M143 145h39" stroke="#83a3d6" stroke-width="8"/>':
    '<rect x="95" y="110" width="130" height="115" rx="12" fill="#fff" stroke="#4b638c" stroke-width="8"/><path d="M82 110h156M160 110v115" stroke="#83a3d6" stroke-width="13"/><path d="M130 106q-30-38 0-42 22-2 30 42m0 0q8-44 30-42 30 4 0 42" fill="none" stroke="#4b638c" stroke-width="7"/>';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="300" viewBox="0 0 320 300"><rect width="320" height="300" rx="24" fill="#eef4ff"/>${art}<text x="160" y="274" text-anchor="middle" fill="#4b638c" font-size="13" font-family="sans-serif">연구용 예시 이미지</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
