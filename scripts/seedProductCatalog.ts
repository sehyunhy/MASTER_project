import { dbClient } from "./common";

// Synthetic, brand-neutral catalog concepts for development and QA. These are not
// verified retail SKUs and must not be treated as real product-market data.
const productTypes: [string, string, number, string][] = [
  ["텀블러", "생활용품", 18000, "일상에서 음료를 휴대할 수 있는 용기"],
  ["드립 커피 세트", "커피·차", 29000, "집에서 간편하게 커피를 준비하는 구성"],
  ["원두 샘플 박스", "커피·차", 24000, "여러 종류의 원두를 비교해 볼 수 있는 구성"],
  ["티 블렌딩 세트", "커피·차", 22000, "다양한 차를 즐길 수 있는 구성"],
  ["독서 조명", "독서·문구", 26000, "책을 읽을 때 사용할 수 있는 조명"],
  ["북마크 세트", "독서·문구", 9000, "독서 중 페이지를 표시하는 문구류"],
  ["노트 세트", "독서·문구", 14000, "생각과 일정을 기록할 수 있는 노트 구성"],
  ["펜 세트", "독서·문구", 12000, "일상 기록에 사용할 수 있는 필기구"],
  ["러닝 벨트", "운동·아웃도어", 21000, "가벼운 운동용품을 휴대할 수 있는 벨트"],
  ["운동 타월 세트", "운동·아웃도어", 16000, "운동 후 사용할 수 있는 타월 구성"],
  ["스트레칭 밴드", "운동·아웃도어", 13000, "가벼운 스트레칭에 사용할 수 있는 밴드"],
  ["휴대용 물병", "운동·아웃도어", 17000, "외출과 운동 중 사용할 수 있는 물병"],
  ["여행 파우치", "여행·수납", 19000, "여행 소지품을 분류해 담는 파우치"],
  ["접이식 에코백", "여행·수납", 11000, "외출 시 접어서 휴대할 수 있는 가방"],
  ["케이블 정리 키트", "디지털·액세서리", 10000, "휴대 기기 케이블을 정리하는 소품"],
  ["무선 충전 거치대", "디지털·액세서리", 32000, "호환 기기를 올려 충전하는 거치형 액세서리"],
  ["휴대용 보조배터리", "디지털·액세서리", 35000, "외출 중 기기를 충전할 수 있는 보조 전원"],
  ["데스크 정리함", "홈·데스크", 24000, "책상 위 작은 물건을 정리하는 수납 제품"],
  ["미니 화분 키트", "홈·데스크", 20000, "실내에서 식물을 기를 수 있는 기본 구성"],
  ["캔들 홀더 세트", "홈·데스크", 23000, "실내 공간에 놓아 사용하는 장식 소품"],
  ["핸드 케어 세트", "케어·웰니스", 27000, "손을 관리할 때 사용하는 케어 제품 구성"],
  ["입욕 소금 세트", "케어·웰니스", 18000, "목욕 시간에 사용하는 입욕 제품 구성"],
  ["수면 안대", "케어·웰니스", 12000, "휴식 중 빛을 가리는 안대"],
  ["아로마 디퓨저", "케어·웰니스", 30000, "실내 향을 위한 방향 제품"],
  ["키친 타월 세트", "주방·다이닝", 15000, "주방에서 활용하는 타월 구성"],
  ["밀폐 용기 세트", "주방·다이닝", 25000, "식재료와 음식을 보관하는 용기 구성"],
  ["도마 세트", "주방·다이닝", 34000, "가정에서 재료를 손질하는 주방 도구"],
  ["머그컵 세트", "주방·다이닝", 21000, "음료를 담아 사용하는 컵 구성"],
  ["사진 앨범", "취미·기록", 17000, "인화 사진을 보관하는 앨범"],
  ["퍼즐 키트", "취미·기록", 28000, "여가 시간에 완성하는 퍼즐 구성"],
];
const styles: [string, number][] = [
  ["베이직", 0.82], ["컴팩트", 0.88], ["라이트", 0.92], ["데일리", 0.96],
  ["모던", 1.00], ["내추럴", 1.04], ["클래식", 1.08], ["컬러풀", 1.12],
  ["프리미엄", 1.22], ["기프트", 1.30],
];

const rows = productTypes.flatMap(([baseName, category, basePrice, usage], typeIndex) => styles.map(([style, factor], styleIndex) => ({
  sku: `QA-GIFT-${String(typeIndex * styles.length + styleIndex + 1).padStart(3, "0")}`,
  product_name: `${style} ${baseName}`,
  category,
  price: Math.round(basePrice * factor / 1000) * 1000,
  description: `${usage}. ${style} 스타일로 구성한 합성 QA 카탈로그 품목이며, 실제 판매 상품이나 검증된 SKU가 아닙니다.`,
  image_url: null,
  source: "synthetic_qa",
  version: "product-catalog-v1",
  is_mock: true,
  is_active: true,
})));

if (rows.length !== 300 || new Set(rows.map(row => row.sku)).size !== 300 || new Set(rows.map(row => row.product_name)).size !== 300) {
  throw new Error("Product catalog must contain exactly 300 unique items.");
}

const db = dbClient();
const { error: deleteError } = await db.from("product_catalog").delete().eq("source", "synthetic_qa");
if (deleteError) throw deleteError;
for (let offset = 0; offset < rows.length; offset += 250) {
  const { error } = await db.from("product_catalog").insert(rows.slice(offset, offset + 250));
  if (error) throw error;
}
const { count, error: countError } = await db.from("product_catalog").select("id", { count: "exact", head: true }).eq("source", "synthetic_qa");
if (countError) throw countError;
if (count !== 300) throw new Error(`Expected 300 catalog rows; found ${count ?? 0}.`);
console.log(`Seeded ${count} synthetic QA product catalog items (all is_mock=true).`);
