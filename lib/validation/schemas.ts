import { z } from "zod";

export const startSchema = z.object({ participantCode: z.string().trim().regex(/^P\d{3}$/), role: z.enum(["giver", "recipient"]) });
export const answerSchema = z.object({ participantId: z.string().uuid(), trialId: z.string().uuid().optional(), questionId: z.string(), answer: z.string().min(1),responseTimeMs:z.number().int().nonnegative().optional(),clientTimestamp:z.string().datetime().optional() });
export const eventSchema = z.object({ participantId: z.string().uuid(), trialId: z.string().uuid().optional(), eventType: z.string().min(2), eventTarget:z.string().optional(),eventValue:z.string().optional(),clientTimestamp:z.string().datetime().optional(),elapsedFromTrialStartMs:z.number().int().nonnegative().optional(),payload: z.record(z.string(), z.unknown()).default({}), elapsedMs: z.number().int().nonnegative().optional() });
export const finalSelectionSchema = z.object({ participantId: z.string().uuid(), trialId: z.string().uuid(), candidateId: z.string().uuid() });
