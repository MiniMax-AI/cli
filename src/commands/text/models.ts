import type { Config } from '../../config/schema';

/**
 * Text chat models supported by the MiniMax Messages API.
 *
 * This registry is the single source of truth for valid `--model` values in
 * the `text chat` / `text repl` commands and the `sdk.text` module. Add new
 * model IDs here when the Messages API ships them so the CLI, SDK, help text,
 * and validation stay in lockstep.
 */
export const TEXT_MODELS = [
  'MiniMax-M3',
  'MiniMax-M2.7',
] as const;

export const DEFAULT_TEXT_MODEL = 'MiniMax-M3';

function includesModel(models: readonly string[], model: string): boolean {
  return models.includes(model);
}

/**
 * Resolve the effective text model using the same precedence as the other
 * modalities: explicit flag > configured default (when it is a registered
 * model) > built-in default. A configured default that is not in
 * {@link TEXT_MODELS} is ignored so users can still override with `--model`.
 */
export function textModel(config: Config, model?: string): string {
  if (typeof model === 'string' && model.length > 0) return model;
  if (
    config.defaultTextModel
    && includesModel(TEXT_MODELS, config.defaultTextModel)
  ) {
    return config.defaultTextModel;
  }
  return DEFAULT_TEXT_MODEL;
}

/**
 * Returns true when `model` is a registered text model ID.
 */
export function isTextModel(model: string): boolean {
  return includesModel(TEXT_MODELS, model);
}
