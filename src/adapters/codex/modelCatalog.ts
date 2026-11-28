/**
 * Builds the Codex model catalog (codex-rs `model_catalog_json` schema,
 * verified against codex-rs v0.172.0: codex-rs/protocol/src/openai_models.rs
 * `ModelInfo` and codex-rs/models-manager models.json).
 *
 * A top-level `model_catalog_json` REPLACES the bundled catalog entirely, so
 * every entry must be a full, valid ModelInfo: required (non-defaulted) fields
 * are slug, display_name, description, supported_reasoning_levels, shell_type,
 * visibility, supported_in_api, priority, support_verbosity, truncation_policy,
 * experimental_supported_tools; remaining
 * fields carry upstream-safe defaults modeled on `model_info_from_slug`
 * (models-manager/src/model_info.rs). `supports_parallel_tool_calls` is
 * required (no serde default) on older supported releases such as
 * rust-v0.148.0-alpha.9, so it is always emitted - as FALSE, because model
 * discovery cannot establish parallel-tool-call support and the upstream
 * unknown-model fallback on 0.148 also uses false; strict Responses gateways
 * that cannot execute parallel calls must not receive parallel requests.
 */

import type { DiscoveredModel } from '../../core/providerConfig/modelDiscovery';
import { CODEX_INSTRUCTIONS_TEMPLATE } from './codexInstructionsTemplate';

/** Safe fallback window, matching the upstream unknown-slug fallback. */
const FALLBACK_CONTEXT_WINDOW = 272_000;

export interface CodexModelCatalogEntry {
  slug: string;
  display_name: string;
  description: string;
  supported_reasoning_levels: unknown[];
  shell_type: 'unified_exec';
  visibility: 'list';
  supported_in_api: true;
  priority: number;
  availability_nux: null;
  upgrade: null;
  support_verbosity: false;
  default_verbosity: null;
  apply_patch_tool_type: null;
  truncation_policy: { mode: 'bytes'; limit: number };
  /** Required without a serde default on older supported releases (e.g. rust-v0.148.0-alpha.9). */
  supports_parallel_tool_calls: false;
  context_window: number;
  max_context_window: number;
  experimental_supported_tools: unknown[];
  input_modalities: string[];
  model_messages: { instructions_template: string };
}

/**
 * Builds the `{"models": [...]}` catalog document from discovered gateway
 * Deterministic: same input models → byte-identical output. Slugs are
 * unique and non-empty (upstream rejects duplicates/empties). Every model the
 * gateway advertises is honored, including gpt-* ids.
 */
export function buildCodexModelCatalog(models: DiscoveredModel[]): {
  models: CodexModelCatalogEntry[];
} {
  const entries: CodexModelCatalogEntry[] = [];
  const seenSlugs = new Set<string>();

  for (const model of models) {
    const slug = typeof model.id === 'string' ? model.id.trim() : '';
    // Honor what the gateway advertises: any usable model id it serves —
    // including gpt-* ids — belongs in the catalog. Only drop unusable or
    // duplicate slugs.
    if (slug.length === 0 || seenSlugs.has(slug)) {
      continue;
    }
    seenSlugs.add(slug);

    const contextWindow = typeof model.contextWindow === 'number' && model.contextWindow > 0
      ? model.contextWindow
      : typeof model.maxInputTokens === 'number' && model.maxInputTokens > 0
        // Discovered input limit is a conservative, per-model bound — prefer
        // it over the generic unknown-slug fallback so a 32k-input model is
        // not compacted as though it supported 272k.
        ? model.maxInputTokens
        : FALLBACK_CONTEXT_WINDOW;

    entries.push({
      slug,
      display_name: typeof model.name === 'string' && model.name.trim().length > 0
        ? model.name.trim()
        : slug,
      description: 'AIdome gateway model managed by the Endpoint Switchboard.',
      supported_reasoning_levels: [],
      shell_type: 'unified_exec',
      visibility: 'list',
      supported_in_api: true,
      priority: entries.length + 1,
      availability_nux: null,
      upgrade: null,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'bytes', limit: 10_000 },
      supports_parallel_tool_calls: false,
      context_window: contextWindow,
      max_context_window: contextWindow,
      experimental_supported_tools: [],
      input_modalities: ['text', 'image'],
      model_messages: { instructions_template: CODEX_INSTRUCTIONS_TEMPLATE }
    });
  }

  return { models: entries };
}
