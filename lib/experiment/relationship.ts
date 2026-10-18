import type { Intimacy, Role } from "@/lib/types";
import { EXPERIMENT } from "@/config/experiment";
import v3Stimuli from "@/config/gift-stimuli-v3.final.json";

type RelationshipCopy = Record<Intimacy, { relationship_type: string; situation: string }>;
export const RELATIONSHIP_STIMULUS_VERSION = "relationship-types-v3";
export type RelationshipType = "romantic_partner" | "distant_college_peer";

export function assignedRelationshipType(condition: string | null | undefined): RelationshipType | null {
  return condition === "high" || condition === "romantic_partner" ? "romantic_partner"
    : condition === "low" || condition === "distant_college_peer" ? "distant_college_peer" : null;
}

export function relationshipScenarioId(profileId: string, condition: string | null | undefined) {
  const type = assignedRelationshipType(condition);
  if (!type) throw new Error("RELATIONSHIP_ASSIGNMENT_MISSING");
  return `gift-scenario-${profileId}-${type}`;
}

function topicParticle(name: string) {
  const last = name.charCodeAt(name.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? "은" : "는";
}

export function relationshipV3(condition: string | null | undefined, role: Role, name: string) {
  const type = assignedRelationshipType(condition);
  if (!type) throw new Error("RELATIONSHIP_ASSIGNMENT_MISSING");
  const stimulus = v3Stimuli.relationship_stimuli.find(item => item.relationship_type === type);
  if (!stimulus) throw new Error("RELATIONSHIP_STIMULUS_MISSING");
  const situation = role === "giver"
    ? stimulus.giver_template.replace("{name}는", `${name}${topicParticle(name)}`)
    : stimulus.recipient_text;
  return {
    heading: "관계 유형과 교류 상황",
    conditionLabel: stimulus.label,
    intimacyCondition: type === "romantic_partner" ? "high" : "low",
    relationshipType: type,
    situation,
    source: RELATIONSHIP_STIMULUS_VERSION,
  };
}

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
export function relationshipForParticipant(intimacyCondition: string | null | undefined, role: Role, approvedCopy?: unknown, profile?: {version?:string;name?:string;relationshipType?:string|null}) {
  if (profile?.version === "profiles-v3-relationship-types" && profile.name) return relationshipV3(profile.relationshipType??intimacyCondition, role, profile.name);
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
