export const clientStudyEvents = new Set([
  "screen_view", "page_loaded", "page_hidden", "tab_hidden", "tab_visible",
  "window_blurred", "window_focused", "connection_lost", "connection_restored",
  "prompt_started", "prompt_changed", "prompt_submitted", "prompt_rejected",
  "prompt_focused", "prompt_blurred", "prompt_pasted", "prompt_input", "candidate_request",
  "candidate_opened", "candidate_closed", "candidate_revisited", "candidate_dwell",
  "candidate_card_exposure", "candidate_confirmation_attempt", "candidate_confirmation_cancelled",
  "candidate_detail_scroll_depth", "candidate_image_failed", "message_exposure",
  "comparison_opened", "comparison_closed", "comparison_exposure", "comparison_scroll_depth", "chat_scroll_depth",
  "viewport_changed",
  "selection_draft", "selection_changed", "reason_started", "reason_changed",
  "reason_submitted", "reason_focused", "reason_blurred", "reason_pasted", "reason_input",
  "finalize_attempt", "action_requested", "page_unloaded", "page_restored",
  "validation_blocked", "survey_started", "transition_opened",
  "retry", "error", "observation_started", "external_product_link_opened",
]);

export type ClientStudyEvent = {
  role: "giver" | "recipient";
  trialId: string;
  phaseAtCapture: string;
  eventType: string;
  target?: string;
  payload: Record<string, unknown>;
  key: string;
  clientAt: string;
  visitId: string;
  tabId: string;
  clientSequence: number;
  clientElapsedMs: number;
  uiSurface?: string;
  operationId?: string;
};
