import type { ProfileSecrets } from '../core/profiles/profileSecrets';

/** Runtime services adapters may use while building a plan. */
export interface AdapterDependencies {
  profileSecrets?: Pick<ProfileSecrets, 'getSecret'>;
}
