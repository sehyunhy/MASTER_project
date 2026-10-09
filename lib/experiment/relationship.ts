import type { Intimacy, Role } from "@/lib/types";
import { EXPERIMENT } from "@/config/experiment";

type RelationshipCopy = Record<Intimacy, { relationship_type: string; situation: string }>;

/** Use only complete, version-matched wording entered by the researcher. */
export async function loadApprovedRelationshipCopy(db: any): Promise<unknown> {
  const { data, error } = await db.from("experiment_configs")
    .select("value,version").eq("key", "relationship_context_v1").maybeSingle();
  if (error) throw error;
  return data?.version === EXPERIMENT.version ? data.value : null;
}

function approvedCondition(copy: unknown, condition: Intimacy | null) {
  if (!condition || !copy || typeof copy !== "object") return null;
  const value = (copy as Partial<RelationshipCopy>)[condition];
  if (!value || typeof value.relationship_type !== "string" || typeof value.situation !== "string") return null;
  const relationshipType = value.relationship_type.trim();
  const situation = value.situation.trim();
  if (!relationshipType || !situation || relationshipType.length > 100 || situation.length > 500) return null;
  return { relationshipType, situation };
}

/** Keep relationship context tied to the participant's assigned condition. */
export function relationshipForParticipant(intimacyCondition: string | null | undefined, role: Role, approvedCopy?: unknown) {
  const condition: Intimacy | null = intimacyCondition === "high" || intimacyCondition === "low"
    ? intimacyCondition
    : null;
  const details = approvedCondition(approvedCopy, condition);

  return {
    heading: role === "giver" ? "당신과 선물 받는 사람의 관계" : "당신과 선물 주는 사람의 관계",
    conditionLabel: condition === "high" ? "친밀도 높음" : condition === "low" ? "친밀도 낮음" : "친밀도 정보 없음",
    intimacyCondition: condition,
    relationshipType: details?.relationshipType ?? null,
    situation: details?.situation ?? null,
    source: details ? "researcher_approved_config" as const : "participant_assignment" as const,
  };
}
