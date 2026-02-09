# ADR-002: Dialect-First Design

## Status
Accepted

## Context
LLM endpoints expose different API formats. We need to determine how configuration flows through the system. The key question: Should we detect dialect after configuration, or should dialect detection drive the configuration process?

## Decision
We adopted a dialect-first design where dialect detection drives configuration flow and determines which assistants are compatible with an endpoint.

## Rationale

### What is a Dialect?

A dialect is the API format an endpoint speaks. Examples:
- `openai.chat_completions` - OpenAI /v1/chat/completions format
- `anthropic.messages` - Anthropic /v1/messages format  
- `openai.responses` - Newer /v1/responses format
- `github.copilot` - GitHub Copilot proprietary protocol

### Why Dialect-First?

1. **Compatibility validation**: Different assistants support different dialects. By detecting dialect early, we can:
   - Filter out incompatible assistants before configuration
   - Warn users if their endpoint doesn't match assistant expectations
   - Prevent configuration errors due to dialect mismatch

2. **Intelligent defaults**: Knowing the dialect allows us to:
   - Pre-populate model names correctly (GPT vs Claude vs custom)
   - Set appropriate authentication schemes (Bearer vs API-Key header)
   - Configure timeout values based on dialect expectations

3. **Better error messages**: When verification fails, we can:
   - Distinguish between "endpoint unreachable" vs "wrong dialect"
   - Provide specific guidance based on expected vs actual dialect
   - Show relevant documentation for the detected dialect

4. **Multi-dialect endpoint support**: Some gateways (like AIdome) support multiple dialects on different paths:
   - `/openai/v1/chat/completions` (OpenAI dialect)
   - `/anthropic/v1/messages` (Anthropic dialect)
   
   Dialect detection allows us to configure the right path for each assistant.

### How Dialect Detection Works

1. **Primary detection**: Ask user to select expected dialect during profile creation
2. **Auto-detection**: Probe endpoint capabilities (GET /v1/models, introspection endpoints)
3. **Verification**: During verification step, confirm endpoint speaks expected dialect
4. **Fallback**: If detection fails, allow manual dialect selection with warnings

### Registry Integration

Our assistant registry stores dialect compatibility for each assistant:

```json
{
  "key": "cline",
  "dialect": {
    "primary": "openai.chat_completions",
    "alsoPossible": ["anthropic.messages", "openai.responses"]
  }
}
```

This allows the wizard to filter assistants during configuration.

## Consequences

### Positive
- Earlier error detection (at config time vs runtime)
- Smarter configuration with dialect-specific defaults
- Better troubleshooting with dialect-aware diagnostics
- Support for multi-dialect gateways
- Clearer documentation (organized by dialect)

### Negative  
- Requires maintaining dialect compatibility matrix in registry
- Auto-detection adds complexity and potential failure points
- Users must understand dialect concept (mitigated by UX)
- Schema changes to dialect definitions require migration

## Alternatives Considered

### Alternative 1: Endpoint-First (Rejected)
Configure endpoint first, detect dialect after.

**Problems**:
- Can't validate compatibility upfront
- No intelligent defaults
- Errors appear late in flow
- Confusing for users when things don't work

### Alternative 2: No Dialect Abstraction (Rejected)  
Just configure URLs, hope for the best.

**Problems**:
- No compatibility validation
- Every assistant needs custom error handling
- Can't support multi-dialect gateways
- Debugging is extremely difficult

## Implementation Notes

Dialect detection logic lives in:
- `src/core/dialects/dialectDetector.ts` - Detection algorithms
- `src/core/dialects/dialectRules.ts` - Dialect-specific rules

Dialect information is stored in:
- Profile: `profile.dialect` field
- Registry: `assistant.dialect` field

Verification checks dialect match:
- Expected: from profile
- Actual: from endpoint introspection
- Status: Pass if match, Warn if mismatch but compatible, Fail if incompatible

## References
- src/core/dialects/dialectDetector.ts
- src/core/dialects/dialectRules.ts
- src/core/registry/assistants.registry.json
- src/core/orchestration/verifier.ts
