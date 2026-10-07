export type TrialState = "pending" | "active" | "awaiting_survey" | "completed";
const transitions: Record<TrialState, TrialState[]> = { pending:["active"], active:["awaiting_survey"], awaiting_survey:["completed"], completed:[] };
export function canTransition(from:TrialState,to:TrialState){return transitions[from].includes(to);}
export function transition(from:TrialState,to:TrialState){if(!canTransition(from,to))throw new Error(`Invalid trial state transition: ${from} -> ${to}`);return to;}
