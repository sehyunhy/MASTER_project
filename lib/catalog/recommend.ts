type CatalogItem = {
  id: string; sku: string; product_name: string; category: string; price: number; currency?: string;
  description: string; image_url: string | null; image_source: string;
  specifications: Record<string, unknown>; use_cases: string[]; strengths: string[];
  limitations: string[]; care_requirements: string | null; profile_codes: string[]; fit_tags: string[];
  source_type?: string; dataset_version?: string; is_mock?: boolean; is_active?: boolean;
  price_experiment?: number; search_tags_ko?: string[]; source_product_id?: string;
};

const profileTags: Record<string, string[]> = {
  R1: ["fitness","movement","hydration","wellbeing","daily"],
  R2: ["coffee","tea","reading","quiet","desk","home"],
  R3: ["travel","photo","portable","outdoor","organization"],
  R4: ["cooking","dining","home","easy-care"],
  R1v2: ["daily","skincare","body-care"],
  R2v2: ["home","reading","textile","rest"],
  R3v2: ["photo","home","decor"],
  R4v2: ["cooking","dining","home"],
};
const responseTags: Record<string, string[]> = {
  "취향 적합성": ["coffee","tea","reading","fitness","travel","photo","cooking","hobby"],
  "실용성": ["daily","easy-care","organization","portable"],
  "감성적": ["meaningful","photo","reading","hobby"],
  "개인적 의미": ["meaningful","photo","reading","hobby"],
  "일상생활": ["daily","home"],
  "취미활동": ["hobby","fitness","reading","photo","coffee"],
  "새로운 경험": ["experience","outdoor","travel","fun"],
  "편리함": ["portable","easy-care","organization"],
  "의미성": ["meaningful","photo","reading"],
  "재미": ["fun","hobby","experience"],
};

export type GuidedPreference = { priority?: string; priorities?: string[]; context?: string; trait?: string };

export function recommendCatalogItems(items: CatalogItem[], profileCode: string, preferences: GuidedPreference = {}, budget?: number): CatalogItem[] {
  const recipientTags = profileTags[profileCode] ?? [];
  const matching = items.filter(item => item.is_active !== false && item.profile_codes.includes(profileCode) && (budget===undefined||Number(item.price_experiment??item.price)<=budget));
  const sorted = matching.map(item => {
    const tags = new Set([...(item.fit_tags??[]),...(item.search_tags_ko??[])]);
    const profileFit = recipientTags.filter(tag => tags.has(tag)).length;
    const preferenceFit = [...(preferences.priorities??[]),preferences.priority, preferences.context, preferences.trait]
      .filter((answer): answer is string => Boolean(answer))
      .reduce((sum, answer) => sum + (responseTags[answer] ?? []).filter(tag => tags.has(tag)).length, 0);
    return { item, rank: profileFit * 10 + preferenceFit };
  }).sort((a,b) => b.rank-a.rank || String(a.item.source_product_id??a.item.sku).localeCompare(String(b.item.source_product_id??b.item.sku)));
  if (sorted.length < 3) throw new Error(`Not enough active catalog products for recipient profile ${profileCode}.`);
  return sorted.slice(0,3).map(x=>x.item);
}

export function productFitReason(item: CatalogItem, preferences: GuidedPreference, profile: { hobbies?: string[]; preference?: string }): string {
  const reasons: string[] = [];
  if (profile.hobbies?.length) reasons.push(`선물 받는 사람의 ${profile.hobbies.slice(0,2).join("·")} 관심사`);
  if (preferences.context) reasons.push(`선택한 사용 상황(${preferences.context})`);
  if (preferences.trait) reasons.push(`선택한 기준(${preferences.trait})`);
  if (!reasons.length && profile.preference) reasons.push(profile.preference);
  return `${reasons.join("과 ")}와 연결됩니다. ${item.use_cases[0] ?? item.description}`;
}
