export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

// Sonnet 5 enables adaptive thinking by default. Keep short, tightly capped
// calls at their previous no-thinking behavior so outputs are not truncated.
export function shortResponseOptions(model: string) {
  return model === DEFAULT_ANTHROPIC_MODEL ? { thinking: { type: "disabled" as const } } : {};
}
