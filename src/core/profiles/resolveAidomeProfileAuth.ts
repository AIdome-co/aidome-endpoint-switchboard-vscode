import type { ProfileSecrets } from './profileSecrets';
import type { EndpointProfile } from './profileTypes';
import {
  normalizeClaudeBaseUrl,
  readClaudeCodeGatewayConfig,
} from '../../adapters/claudeCode/claudeCodeConfigPatcher';

export async function resolveAidomeProfileAuthToken(
  profile: EndpointProfile,
  profileSecrets: Pick<ProfileSecrets, 'getSecret'>
): Promise<string | undefined> {
  const claudeGatewayConfig = await readClaudeCodeGatewayConfig().catch(() => undefined);
  const normalizedProfileBaseUrl = normalizeClaudeBaseUrl(profile.baseUrl);

  if (
    claudeGatewayConfig?.modelDiscoveryEnabled
    && claudeGatewayConfig.apiKey
    && claudeGatewayConfig.baseUrl === normalizedProfileBaseUrl
  ) {
    return claudeGatewayConfig.apiKey;
  }

  return profile.authRef ? await profileSecrets.getSecret(profile.authRef) : undefined;
}