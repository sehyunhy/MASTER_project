import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
function sign(participantId:string){const secret=process.env.PARTICIPANT_SESSION_SECRET||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw new Error("Participant session signing secret is missing.");return createHmac("sha256",secret).update(participantId).digest("hex");}
export function createParticipantSession(participantId:string){return `${participantId}.${sign(participantId)}`;}
export async function participantSessionMatches(participantId:string){
  const jar=await cookies();
  const value=jar.get("participant_session")?.value??"";const [cookieId,cookieSignature]=value.split(".");if(cookieId!==participantId||!cookieSignature)return false;const expected=sign(participantId);const a=Buffer.from(cookieSignature);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
