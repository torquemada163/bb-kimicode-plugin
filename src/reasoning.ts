// BB resolves an omitted/inherited effort to medium before provider dispatch.
// Kimi Code documents medium -> high (not the model default):
// https://www.kimi.com/code/docs/en/kimi-code/models.html
export const REASONING_LEVELS = ['low', 'medium', 'high', 'max'] as const;

export function normalizeReasoningOptions(options: Record<string, unknown>): void {
  if (options.reasoningLevel === 'medium') options.reasoningLevel = 'high';
}
