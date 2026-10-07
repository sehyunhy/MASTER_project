import { dbClient } from "./common";
const db=dbClient();
const {error}=await db.from("participants").delete().like("participant_code","MOCK-P%");
if(error)throw error;
console.log("Deleted mock participant data only. Real participants and responses were untouched.");
