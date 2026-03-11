# Security Rules

Deep reference for security patterns in this extension.
Use ❌/✅ examples to understand the correct approach.

## SecretStorage — API Keys and Credentials

API keys, tokens, and any credential must live in `vscode.SecretStorage`.
`globalState` is for non-sensitive preferences only.

**❌ Wrong — storing a secret in globalState:**
```typescript
context.globalState.update('apiKey', userEnteredKey);
```

**✅ Correct — storing a secret in SecretStorage:**
```typescript
await context.secrets.store('aidome.apiKey', userEnteredKey);
```

**❌ Wrong — reading a secret from globalState:**
```typescript
const key = context.globalState.get<string>('apiKey');
```

**✅ Correct — reading a secret from SecretStorage:**
```typescript
const key = await context.secrets.get('aidome.apiKey');
// Handle undefined: SecretStorage returns undefined if not set
if (!key) { /* prompt user or show guidance */ }
```

SecretStorage is encrypted by the OS keychain. `globalState` is stored in plaintext
on disk. The distinction matters for enterprise compliance and security reviews.

## Input Validation — URL Schemes

Always validate URLs before using them as endpoint base URLs.

**❌ Wrong — using a URL without validation:**
```typescript
const client = new HttpClient(userSuppliedUrl);
```

**✅ Correct — validating the URL scheme first:**
```typescript
const allowed = ['https:', 'http:'];
const parsed = new URL(userSuppliedUrl);
if (!allowed.includes(parsed.protocol)) {
  throw new Error(`URL scheme not allowed: ${parsed.protocol}`);
}
```

Schemes to block unconditionally: `javascript:`, `data:`, `file:`, `ftp:`.
Only allow `https:` in production. Allow `http:` in development/localhost only.

## Logging Redaction

Sensitive values must never appear in plaintext in logs or diagnostics exports.

**❌ Wrong — logging an API key directly:**
```typescript
logger.debug(`Connecting with key: ${apiKey}`);
```

**✅ Correct — redacting before logging:**
```typescript
import { redactString } from '../util/redact';
logger.debug(`Connecting with key: ${redactString(apiKey)}`);
```

**❌ Wrong — logging a full endpoint URL that may contain auth:**
```typescript
logger.info(`Base URL: ${profile.baseUrl}`);
```

**✅ Correct — redact the URL or log only the hostname:**
```typescript
logger.info(`Base URL: ${redactString(profile.baseUrl)}`);
```

The redaction utility handles common secret patterns (API key prefixes, Bearer tokens,
long opaque strings). When in doubt, redact.

## No `console.log`

The `console` object must not be used anywhere in `src/`. All log output goes through
the Logger class, which writes to the extension's output channel and applies redaction.

**❌ Wrong:**
```typescript
console.log('Setup complete');
console.error(error);
```

**✅ Correct:**
```typescript
logger.info('Setup complete');
logger.error('Setup failed', error);
```

The ESLint `no-console` rule and the pre-release validation test both enforce this.
A CI lint failure or validation test failure means `console.*` was used in `src/`.

## Backup-Before-Modify

Before writing to any assistant config file, create a timestamped backup.

**❌ Wrong — overwriting directly:**
```typescript
fs.writeFileSync(configPath, newContent);
```

**✅ Correct — backup first, then write:**
```typescript
const backup = `${configPath}.bak.${Date.now()}`;
fs.copyFileSync(configPath, backup);
fs.writeFileSync(configPath, newContent);
```

If the write fails, the backup is still there. This is ADR-003 and is an architectural
invariant — never skip backups, even for small config changes.

## Extension Permissions

The `package.json` activation events and contribution points define the extension's
surface area. Keep them minimal:

- Only declare the commands that the extension actually provides.
- Do not request filesystem permissions beyond what adapters need.
- Do not add telemetry, analytics, or network calls that aren't part of the core
  endpoint routing functionality.
- Review `.vscodeignore` before packaging: `src/`, `test/`, `node_modules/`, and
  any development-only files must be excluded from the VSIX.
