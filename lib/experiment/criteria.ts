export const RECOMMENDATION_CRITERIA = ["취향 적합성", "실용성", "감성적"] as const;
export type RecommendationCriterion = typeof RECOMMENDATION_CRITERIA[number];

export function normalizeCriterion(value: string): string {
  return value.trim() === "개인적 의미" ? "감성적" : value.trim();
}

export function normalizeCriteria(values: readonly string[] = []): string[] {
  return [...new Set(values.map(normalizeCriterion).filter(Boolean))];
}

export function toggleCriterion(values: readonly string[], criterion: string): string[] {
  const current=normalizeCriteria(values);
  const target=normalizeCriterion(criterion);
  return current.includes(target)?current.filter(value=>value!==target):[...current,target];
}

export function mergeCriteria(values: readonly string[], text: string, inferred?: string|null): string[] {
  return normalizeCriteria([...values,...criteriaInText(text),...(inferred?[inferred]:[])]);
}

export function criteriaInText(text: string): string[] {
  const normalized=participantCriterionText(text);
  return RECOMMENDATION_CRITERIA.filter(value => normalized.includes(value))
    .sort((left,right)=>normalized.indexOf(left)-normalized.indexOf(right));
}

export function isOnlyCriteria(text: string): boolean {
  const remainder = text.replaceAll("개인적 의미", "감성적")
    .replaceAll("취향 적합성", "").replaceAll("실용성", "").replaceAll("감성적", "")
    .replace(/[\s,，·、와과및+]+/g, "");
  return criteriaInText(text).length > 0 && !remainder;
}

export function participantCriterionText(text: string): string {
  return text.replace(/개인적 의미(를|을|가|이|는|은)/g, (_match, particle:string) =>
    "감성적 기준" + ({를:"을",을:"을",가:"이",이:"이",는:"은",은:"은"} as Record<string,string>)[particle])
    .replaceAll("개인적 의미", "감성적");
}
