# ADR-001: Profiles Over Flat base_url Setting

## Status
Accepted

## Context
We need a way to store and manage endpoint configurations for AI assistant tools. We considered two approaches:

1. **Flat base_url setting**: A single `aidome.baseUrl` setting in VS Code configuration
2. **Named profiles**: Multiple named profiles stored in globalState with profile switching

## Decision
We chose to use named profiles instead of a single flat base_url setting.

## Rationale

### Why Named Profiles?

1. **Multi-environment support**: Users often need to switch between development, staging, and production endpoints. Profiles make this trivial with one-click switching rather than editing settings each time.

2. **Per-profile authentication**: Different endpoints may require different API keys. Profiles allow us to store authentication tokens securely in VS Code SecretStorage, namespaced by profile name.

3. **Profile-specific metadata**: Each profile can track:
   - Last verified timestamp
   - Dialect (openai.chat_completions, anthropic.messages, etc.)
   - Profile type (aidome vs custom)
   - Tenant information (for multi-tenant gateways)

4. **Rollback capability**: With profiles, we can track which assistants are configured for each profile and roll back changes if verification fails.

5. **Future extensibility**: Profiles allow adding per-profile settings like:
   - Custom headers
   - Timeout overrides
   - Proxy configuration
   - Model mappings

### Why Not Flat base_url?

A flat `aidome.baseUrl` setting would require:
- Manual editing to switch endpoints
- No built-in authentication management
- No change tracking or rollback
- Difficult to support multiple environments
- No metadata for verification or debugging

## Consequences

### Positive
- Seamless multi-environment workflow
- Secure per-profile authentication
- Better UX for profile management
- Enables sophisticated verification and diagnostics
- Supports future features like custom headers per profile

### Negative
- Slightly more complex implementation
- Requires migration mechanism for future schema changes
- Users must learn profile concept (mitigated by wizard UX)

## Implementation Notes

Profiles are stored in VS Code globalState with structure:
```typescript
interface EndpointProfile {
  id: string;
  name: string;
  profileType: 'aidome' | 'custom';
  baseUrl: string;
  dialect: string;
  authRef?: string;
  tenant?: string;
  createdAt: string;
  updatedAt: string;
  lastVerified?: string;
}
```

Authentication tokens are stored separately in SecretStorage with key format:
`aidome-switchboard.profile.<profileName>.authToken`

## References
- src/core/profiles/profileStore.ts
- src/core/profiles/profileSecrets.ts
- src/core/profiles/profileTypes.ts
