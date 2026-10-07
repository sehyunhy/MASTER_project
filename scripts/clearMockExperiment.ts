import { dbClient } from "./common";
const db=dbClient();
const {error}=await db.from("participants").delete().like("participant_code","MOCK-P%");
if(error)throw error;
const {error2}=await db.from("gift_candidates").delete().eq("is_mock",true);
if(error2)throw error2;
console.log("Deleted mock participant data only. Real participants and responses were untouched.");
