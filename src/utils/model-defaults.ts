/**
 * Model-aware defaults for the Messages API.
 *
 * The MiniMax Messages API documents per-model recommendations and maxima for
 * `max_tokens`. Different models also support different `thinking` controls.
 *
 * Centralizing these here keeps the CLI commands and the SDK in lockstep — if
 * the API contract changes, the one place to update is this file.
 *
 * Mirror tests live at test/utils/model-defaults.test.ts.
 */

/**
 * Per-model default `max_tokens` when the user does not pass `--max-tokens`.
 *
 * Per the current Messages API contract:
 *   - MiniMax-M3:  recommended 131072 (128K), max 524288 (512K)
 *   - other supported models (MiniMax-M2.5, MiniMax-M2.7, etc.): 65536 (64K)
 *
 * `max_tokens` is an output ceiling, so the recommendation can still be
 * overridden downward by the CLI user with `--max-tokens <n>` (e.g. 8192) for
 * tighter budgets or response-shape constraints.
 */
export function resolveMaxTokens(model: string, flagValue: number | undefined): number {
  if (flagValue !== undefined) return flagValue;
  if (model === 'MiniMax-M3') return 131072;
  return 65536;
}

/**
 * Allowed values for the `--thinking` CLI flag / `ChatRequest.thinking.type`.
 *
 * Per the Messages API contract, when the `thinking` field is omitted entirely
 * the API defaults thinking to disabled for M3. The CLI therefore omits the
 * field unless the user passes `--thinking <mode>` explicitly.
 */
export const THINKING_MODES = ['enabled', 'disabled', 'adaptive'] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

/**
 * Validate and normalize a `--thinking` value. Returns the lowercased mode
 * when it matches a known set, or `undefined` when the input is empty/absent.
 * Throws on unknown values so the CLI can surface a clean CLIError before
 * sending.
 */
export function resolveThinkingMode(value: unknown): ThinkingMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).toLowerCase();
  if ((THINKING_MODES as readonly string[]).includes(v)) return v as ThinkingMode;
  throw new Error(
    `Invalid --thinking value "${String(value)}". Expected one of: ${THINKING_MODES.join(', ')}.`,
  );
}
