export type StudyRole = "giver" | "recipient";

export function validParticipantId(value: string, role: StudyRole) {
  if (!/^K[0-9]{2,8}$/.test(value)) return false;
  const number = Number(value.slice(1));
  return number > 0 && value === `K${String(number).padStart(2, "0")}` &&
    counterpartId(value, role).length <= 9 &&
    number % 2 === (role === "giver" ? 0 : 1);
}

export function counterpartId(value: string, role: StudyRole) {
  const number = Number(value.slice(1)) + (role === "giver" ? -1 : 1);
  return "K" + String(number).padStart(2, "0");
}
