/**
 * Adapter for Cline assistant.
 *
 * ⚠️ RISK: Cline stores its API configuration (provider, base URL, model) in
 * webview globalState, NOT in VS Code settings.json contributions.  The
 * switchboard writes VS Code settings (e.g. `cline.openAiBaseUrl`) which may
 * not be read by all Cline versions.  The fallback key discovery in
 * discoverSettingKeys() mitigates this, but verify after major Cline updates
 * that the settings-based approach still takes effect.
 * Verified against: Cline v3.x source (saoudrizwan/claude-dev) as of 2026-04-24.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VscodeSettingsAdapter } from '../VscodeSettingsAdapter';

/**
 * Cline assistant adapter.
 */
export class ClineAdapter extends VscodeSettingsAdapter {
  protected readonly extensionId = 'saoudrizwan.claude-dev';
  protected readonly assistantKey = 'cline';

  protected getKeyMatchPatterns(): RegExp {
    return /(baseurl|base_url|openai.*base)/;
  }

  protected getFallbackKeys(): string[] {
    return [
      'cline.openAiBaseUrl',
      'cline.baseUrl',
      'cline.openaiBaseUrl'
    ];
  }

  protected getGuidedSteps(profile: EndpointProfile): GuidedStepsData {
    return {
      message: 'Please configure Cline base URL manually in extension settings',
      steps: [
        'Open VS Code Settings (Ctrl+, or Cmd+,)',
        'Search for "Cline" or "claude-dev"',
        'Locate the base URL or API endpoint setting (e.g. cline.openAiBaseUrl)',
        `Set the value to: ${profile.baseUrl}`,
        'Save the settings and reload Cline if prompted'
      ],
      baseUrl: profile.baseUrl
    };
  }

  getDisplayName(): string {
    return 'Cline';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
