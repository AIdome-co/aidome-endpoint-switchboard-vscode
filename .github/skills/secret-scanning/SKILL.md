---
name: secret-scanning
description: >
  Use when configuring secret scanning and push protection for the AIdome
  Endpoint Switchboard repository. Covers alert triage, custom patterns for
  AIdome API keys, and integration with the extension's SecretStorage model.
---

# Skill: Secret Scanning

## When to Use

Invoke this skill when you need to:
- Enable or configure secret scanning for this repository
- Set up push protection to block accidental secret commits
- Define custom patterns for AIdome-specific API key formats
- Triage secret scanning alerts
- Resolve a blocked push from the command line
- Verify that extension source code does not leak secrets

## Project Context

The AIdome Endpoint Switchboard extension handles sensitive data:
- **API keys** for LLM providers (OpenAI, Anthropic, Azure OpenAI, etc.)
- **Base URLs** for enterprise endpoints (may contain auth tokens in query params)
- **Profile credentials** stored in `vscode.SecretStorage`

The extension's security model requires that secrets never appear in:
- Source code or compiled output
- Log files or diagnostics exports
- Git history
- Test fixtures (use placeholder values instead)

## Step 1 — Enable Secret Scanning

1. Navigate to repository **Settings** → **Advanced Security**
2. Enable **Secret Protection**
3. Enable **Push protection** to block secrets during push

## Step 2 — Configure Push Protection

Push protection blocks commits containing detected secrets. This is critical for
a project that handles API keys and endpoint credentials.

When push protection blocks a push:

### Option A — Remove the Secret

```bash
# If the secret is in the latest commit
git commit --amend --all
git push

# If the secret is in an earlier commit
git rebase -i <COMMIT-ID>~1
# Mark the offending commit as 'edit', remove the secret, then:
git commit --amend
git rebase --continue
git push
```

### Option B — Use a Placeholder Instead

Replace real secrets with placeholder values:

```typescript
// ❌ Real API key in test fixture
const testKey = 'sk-abc123realkey';

// ✅ Placeholder value
const testKey = 'sk-aidome-test-placeholder-do-not-use';
```

## Step 3 — Configure Exclusions

Create `.github/secret_scanning.yml` to exclude test fixtures with known placeholder
values:

```yaml
paths-ignore:
  - "test/fixtures/**"
```

**Important**: Keep exclusions minimal. Every excluded path is a potential blind spot.

## Step 4 — Define Custom Patterns (Optional)

If AIdome uses a proprietary API key format, define a custom pattern:

1. Settings → Advanced Security → Custom patterns → **New pattern**
2. Enter the regex for the AIdome key format
3. Add a test string to verify the pattern
4. **Save and dry run** to check for false positives
5. **Publish** and optionally enable push protection for the pattern

## Extension Source Code Checks

Beyond repository-level scanning, verify these patterns in the extension code:

### No Hardcoded Secrets

```typescript
// ❌ VIOLATION — hardcoded API key
const apiKey = 'sk-real-api-key-here';

// ✅ CORRECT — read from SecretStorage
const apiKey = await context.secrets.get(`profile:${profileId}:apiKey`);
```

### No Secrets in Logs

```typescript
// ❌ VIOLATION — secret in log output
logger.info(`Using API key: ${apiKey}`);

// ✅ CORRECT — redacted before logging
logger.info(`Using API key: ${redact(apiKey)}`);
```

### No Secrets in Test Fixtures

```typescript
// ❌ VIOLATION — looks like a real key
const mockProfile = { apiKey: 'sk-proj-abc123def456' };

// ✅ CORRECT — obviously fake placeholder
const mockProfile = { apiKey: 'sk-aidome-test-placeholder' };
```

### No Secrets in Configuration Examples

```jsonc
// ❌ VIOLATION — documentation with real-looking key
{ "apiKey": "sk-proj-real-looking-key-abc123" }

// ✅ CORRECT — clearly marked placeholder
{ "apiKey": "<your-api-key-here>" }
```

## Alert Triage

When secret scanning raises an alert:

| Alert Type | Priority | Action |
|---|---|---|
| API key (OpenAI, Anthropic, etc.) | Critical | Rotate immediately, then remove from history |
| AIdome gateway token | Critical | Rotate at AIdome admin portal, remove from history |
| Generic secret / private key | High | Investigate — is it a test placeholder or real? |
| Connection string | High | Rotate credentials, update SecretStorage |
| Non-provider pattern | Medium | Review — may be a false positive |

## Pre-Release Validation

The extension's pre-release validation tests already check for `console.log` in
source code. Consider extending them to scan for:
- Strings matching common API key patterns
- Base64-encoded values longer than 32 characters
- URLs with `key=` or `token=` query parameters

## Checklist

- [ ] Secret scanning enabled for the repository
- [ ] Push protection enabled and tested
- [ ] Test fixtures use placeholder values, not real-looking keys
- [ ] Extension source uses SecretStorage for all credentials
- [ ] All log output passes through the redaction utility
- [ ] Custom patterns defined for any proprietary key formats
- [ ] Exclusion paths in `.github/secret_scanning.yml` are minimal
