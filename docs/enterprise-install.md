# Enterprise Installation Guide

## Recommended Enterprise Rollout

1. **Pilot first** with a small group that represents your operating systems, remote-development modes, and target assistants.
2. **Package or allowlist** the extension ID `aidome.aidome-endpoint-switchboard` through your standard VS Code extension-management policy.
3. **Distribute profile values** out-of-band: gateway URL, dialect, tenant naming, and token-request process. Do not pre-place API tokens in files or settings.
4. **Publish network prerequisites** for VPN, proxy, DNS, firewall, and internal CA trust before broad rollout.
5. **Ask users to verify routes** after setup and after any gateway, certificate, or assistant extension upgrade.
6. **Collect redacted diagnostics** only when troubleshooting; diagnostics are designed for support review but should still be handled as operational data.

## Pre-Installation Requirements

Publish these details before broad installation so teams can complete setup without guessing:

| Requirement | What to provide |
|-------------|-----------------|
| Gateway URLs | Approved base URLs per environment, including whether each URL should include `/v1`. |
| Dialects | The required Switchboard dialect for each gateway front door, such as `openai.chat_completions`, `openai.responses`, or `anthropic.messages`. |
| Credential/token process | Where users request tokens, expected scopes, expiration/rotation rules, and support contacts for `401`/`403` failures. |
| Proxy variables | Required `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` values for local and remote development contexts. |
| Certificate trust | Internal CA bundle or OS trust-store instructions; avoid disabling TLS verification except for approved internal endpoints. |
| Supported assistants | The expected assistant list and tier per team, including which assistants should be assigned to production profiles. |

Tokens should be entered by each user during setup so they land in VS Code SecretStorage. Do not distribute tokens through settings files, checked-in docs, machine images, or Settings Sync.

## Installing from .vsix (Air-Gapped / Offline)

For environments without internet access:

1. Download the `.vsix` file from [GitHub Releases](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/releases)
2. In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Select the downloaded `.vsix` file
4. Reload VS Code

## Enterprise VS Code Policy

To allowlist this extension in your organization's VS Code policy:

**Extension ID**: `aidome.aidome-endpoint-switchboard`

### Settings Sync

The extension stores profiles in VS Code's `globalState`, which is not synced via Settings Sync by default. API tokens are stored separately in VS Code SecretStorage. This is by design: endpoint configurations and credentials should remain environment-specific, especially when users move between local and remote VS Code contexts.

### Proxy Configuration

If your organization uses an HTTP proxy, set the `HTTPS_PROXY` environment variable. The extension respects this for all outbound HTTP requests.

```bash
export HTTPS_PROXY=http://proxy.yourorg.com:8080
export NO_PROXY=localhost,127.0.0.1
```

## Security Posture

- **No telemetry**: Zero data collection
- **Local processing only**: All configuration is done locally
- **SecretStorage**: Auth tokens encrypted via VS Code's native SecretStorage API and kept out of org-wide settings or Settings Sync
- **Audit trail**: Full change log available via "Export Diagnostics"
- **Reversible**: All changes can be undone via "Reset Switchboard"

## TLS / Certificate Configuration

### Default behaviour

All HTTPS requests made by the extension verify TLS certificates by default (`aidome-switchboard.advanced.tlsVerify: true`). This includes the 7-step verification pipeline and every HTTPS call to the configured gateway.

### Internal gateways with self-signed or private-CA certificates

If the LLM gateway uses an internally-issued certificate that is not trusted by the operating system or Node.js:

1. **Preferred** — add the root CA to the system trust store and/or set `NODE_EXTRA_CA_CERTS`:
   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/internal-ca.pem
   ```

2. **Alternative** — disable TLS verification for the extension:
   ```jsonc
   // settings.json
   "aidome-switchboard.advanced.tlsVerify": false
   ```
   Or via environment variable (useful for managed terminals):
   ```bash
   export AIDOME_SWITCHBOARD_TLS_VERIFY=false
   ```

> ⚠️ Disabling TLS verification removes certificate validation for **all** HTTPS requests made by this extension. Use only when the gateway is on a trusted internal network.

### Per-assistant TLS overrides

Individual assistants may also reject self-signed certificates independently of this extension. The following table summarises each assistant's TLS control surface:

| Support Level | Assistants | How to Disable |
|---|---|---|
| **Native setting** | Continue.dev | `requestOptions.rejectUnauthorized: false` in `config.json` |
| **Env var** | Claude Code | `ANTHROPIC_DISABLE_TLS_VERIFY=true` |
| **Env var** | Codex CLI | `CODEX_CA_CERTIFICATE` or `SSL_CERT_FILE` (custom CA bundle) |
| **Env var** | AnythingLLM | `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| **VS Code global** | GitHub Copilot, Cline, Roo Code, Kilo Code, CodeGPT, Tabnine | `"http.proxyStrictSSL": false` |
| **None** | Gemini CLI | No documented mechanism |

For full details per assistant, see the `tlsVerification` field in `src/core/registry/assistants.registry.json`.

## Org-Wide Default Profiles

Currently, profiles are per-user (stored in globalState). For org-wide defaults:

1. Distribute a profile configuration document to your team with the approved profile name, base URL, dialect, optional tenant, and supported assistant list.
2. Each user creates the profile via the wizard and stores their own token in SecretStorage.
3. Ask users to run "AIdome: Verify All Profile Routes" after setup.
4. Use "Export Diagnostics" only for support cases where you need to verify consistent configuration.

Future versions may support `.aidome-profile.json` workspace files for team-shared configurations.

## Firewall & Network Requirements

The extension makes HTTPS requests to:
- Your configured LLM gateway endpoint (for verification and model discovery)

**Required ports**:
- **443** (HTTPS) — for secure gateway communication
- **8080** (HTTP) — optional, for development/testing gateways

Ensure your firewall rules allow outbound connections to your gateway endpoint.
