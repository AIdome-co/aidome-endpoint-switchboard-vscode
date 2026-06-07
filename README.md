# LLM Endpoint Switchboard (by AIdome)

> Configure your AI coding assistants to route through enterprise-approved LLM endpoints — in one click.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/aidome.aidome-endpoint-switchboard)](https://marketplace.visualstudio.com/items?itemName=aidome.aidome-endpoint-switchboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is this?

The **LLM Endpoint Switchboard** is a **configuration tool** that helps enterprise teams redirect AI coding assistants to use approved LLM gateway endpoints. Instead of manually configuring each AI assistant separately, this extension manages endpoint configuration across all your AI tools from one place.

> ### ⚠️ Important: This Extension is NOT a Gateway
>
> This extension **does not proxy, relay, or intercept** any API calls. It configures other extensions to point to YOUR gateway.

**The value:** One tool manages endpoint configuration across all your AI assistants — Continue, Cline, Roo Code, Kilo Code, Codex CLI, and more.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    VS Code                          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Cline   │  │ Continue │  │ Roo Code │  ...     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │              │              │               │
│       └──────────────┼──────────────┘               │
│                      │                              │
│            ┌─────────▼──────────┐                   │
│            │    Switchboard     │                   │
│            │  (this extension)  │                   │
│            │  Configures each   │                   │
│            │  assistant's       │                   │
│            │  base_url + auth   │                   │
│            └─────────┬──────────┘                   │
│                      │                              │
└──────────────────────┼──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Your Gateway   │
              │  (AIdome /      │
              │   LiteLLM /     │
              │   custom)       │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
     │ OpenAI │  │Claude  │  │Gemini  │
     └────────┘  └────────┘  └────────┘
```

---

## Supported Assistants

| Assistant | Type | Tier | Auto-Configure? | Dialect |
|-----------|------|------|-----------------|---------|
| Continue.dev | VS Code Extension | A — Full | ✅ Yes | OpenAI Chat |
| Cline | VS Code Extension | A — Full | ✅ Yes | OpenAI Chat |
| Roo Code | VS Code Extension | A — Full | ✅ Yes | OpenAI Chat |
| Kilo Code | VS Code Extension | A — Full | ✅ Yes | OpenAI Chat |
| OpenAI Codex CLI | CLI | A — Full | ✅ Yes | OpenAI Responses |
| CodeGPT | VS Code Extension | B — Partial | ⚡ Partial | OpenAI Chat |
| AnythingLLM | Desktop App | B — Guided | 📋 Guided | OpenAI Chat |
| Claude Code | CLI + Extension | A — Full | ✅ Yes | Anthropic Messages |
| GitHub Copilot | VS Code Extension | B — Partial | ⚡ Partial | Proxy / OpenAI Chat |
| Gemini CLI | CLI | C — Info | ℹ️ Info Only | Google Gemini |
| Tabnine | VS Code Extension | C — Info | ℹ️ Info Only | Proprietary |

Claude Code gateway routing:

- Configures Claude Code user settings (`~/.claude/settings.json` by default, or `CLAUDE_CONFIG_DIR/settings.json` when overridden) with `env.ANTHROPIC_BASE_URL` for Anthropic Messages-compatible gateways.
- Requires raw OpenAI `/v1/chat/completions` endpoints to be fronted by a gateway that exposes Anthropic Messages, Bedrock InvokeModel, or Vertex rawPredict semantics.
- Enables `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`; Claude Code uses that only on v2.1.129+ with Anthropic Messages gateways and only surfaces gateway models whose IDs begin with `claude` or `anthropic`.
- When Claude Code is assigned to a profile, profile activation rewrites `env.ANTHROPIC_AUTH_TOKEN` in the shared Claude settings file from that profile's stored secret, and clears any stale `env.ANTHROPIC_API_KEY` value so Claude Code stays in the gateway bearer-token path.

### Tier Explanation

- **Tier A — Full Automation**: Extension automatically writes all configuration. One click.
- **Tier B — Partial / Guided**: Extension auto-discovers settings where possible, provides step-by-step guidance otherwise.
- **Tier C — Informational**: Extension detects the assistant, explains routing limitations, and suggests alternatives.

---

## Dialects

Different AI providers use different API protocols. The Switchboard understands these and maps them correctly:

- **`openai.chat_completions`** — Most common, `/v1/chat/completions` (Continue, Cline, Roo Code, Kilo Code, CodeGPT, AnythingLLM)
- **`openai.responses`** — Newer OpenAI format, `/v1/responses` (OpenAI Codex CLI)
- **`anthropic.messages`** — Anthropic's `/v1/messages` (Claude Code)
- **`google.gemini.generate_content`** — Google Gemini (Gemini CLI)
- **`github.copilot`** — Routable via proxy override (`debug.overrideProxyUrl`). ⚠️ This setting is undocumented and may change without notice.
- **`tabnine.proprietary`** — Proprietary (not switchable)

---

## Quick Start

### 1. Install the Extension

Install from the VS Code Marketplace or download the `.vsix` from [GitHub Releases](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/releases).

### 2. Gather Your Gateway Details

Before running the wizard, have the following information ready:

- **Gateway base URL**: the root URL for your approved endpoint, for example `https://gateway.yourorg.com` (the extension appends dialect-specific paths such as `/v1/chat/completions` when needed).
- **Dialect**: choose the protocol your gateway exposes. Use `openai.chat_completions` for most OpenAI-compatible gateways, `openai.responses` for Codex CLI-style routing, or `anthropic.messages` for Claude Code-compatible gateways.
- **API key or bearer token**: optional for unauthenticated internal gateways; otherwise stored in VS Code SecretStorage.
- **Assistant list**: decide which installed assistants should be assigned to the profile now and which should remain unchanged.

### 3. Run the Setup Wizard

1. Open Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Run: **`AIdome: Setup Switchboard`**.
3. Follow the wizard:
   - Detect installed assistants.
   - Create or select an endpoint profile.
   - Choose the assistants to configure.
   - Review the planned configuration changes.
   - Apply configuration and verify connectivity ✅.

### 4. Start Coding

Your AI assistants now route through your approved endpoint. If you add another assistant later, run **`AIdome: Assign Assistants to Profile`** or rerun the setup wizard.

---

## Commands

All commands available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `AIdome: Setup Switchboard` | Launch the guided setup flow for detection, profile selection, assignment, and configuration |
| `AIdome: Verify All Profile Routes` | Verify assistant routing for the active profile |
| `AIdome: Show Models & Providers` | View available models from your gateway |
| `AIdome: Manage Profiles` | Create, edit, delete, inspect, and verify endpoint profiles |
| `AIdome: Assign Assistants to Profile` | Add or remove assistant assignments for a selected profile without recreating the profile |
| `AIdome: Activate Profile` | Switch the active profile and reapply automated adapter mappings for assigned assistants |
| `AIdome: Reset Switchboard` | Undo changes, restore backups, or factory reset Switchboard state |
| `AIdome: Export Diagnostics` | Generate a redacted diagnostic report |
| `AIdome: Refresh` | Refresh the Assistants view in the AIdome activity bar container |

---

## Enterprise Safety

This extension is designed for enterprise environments with strict security requirements:

- 🔒 **SecretStorage**: Auth tokens stored via VS Code's encrypted SecretStorage API — never in settings files
- 📊 **No Telemetry**: Zero data collection. All processing is local.
- 💾 **Backup Before Modify**: Timestamped backups created before any configuration change
- 📋 **Audit Trail**: Full change log with undo capability. Export redacted diagnostics for support.
- 🔐 **Secret Redaction**: Diagnostics reports automatically redact all auth tokens, API keys, and sensitive data
- 🌐 **Remote Aware**: Detects SSH, Dev Containers, Codespaces, WSL — warns about reachability issues
- ↩️ **Full Undo**: Every change can be reversed. Factory reset available with confirmation.

---

## Configuration

### Profiles

Profiles store your endpoint configuration:

- **Name**: Human-readable identifier (e.g., "Production", "Staging")
- **Base URL**: Your LLM gateway endpoint (e.g., `https://gateway.yourorg.com`)
- **Dialect**: API protocol type (e.g., `openai.chat_completions`)
- **Auth**: API key (stored in SecretStorage, never in plain text)
- **Tenant** (optional): Organization or team identifier

Profiles are stored in VS Code's `globalState` and persist across sessions.

### Managing Profiles

Use **`AIdome: Manage Profiles`** to:
- Create new profiles
- Edit existing profiles
- Delete profiles
- Switch between profiles

Use **`AIdome: Assign Assistants to Profile`** when a profile already exists and you only need to change which assistants it controls. Use **`AIdome: Activate Profile`** when you switch environments, such as moving from staging to production; automated adapters are reapplied for the newly active profile.

### Verification Pipeline

Use **`AIdome: Verify All Profile Routes`** after setup, after rotating a token, or whenever an assistant starts returning connectivity errors. The verifier runs these checks for the active profile:

1. **DNS resolution** — confirms the gateway hostname can be resolved; skipped for `localhost`.
2. **TLS verification** — validates HTTPS certificates, or warns when TLS verification is disabled.
3. **Endpoint reachability** — sends an authenticated reachability probe to the profile base URL.
4. **Health check** — looks for common optional health endpoints such as `/health`, `/v1/health`, and `/healthz`.
5. **Model list** — checks `/v1/models` for dialects that normally expose model inventory.
6. **Dialect validation** — probes the dialect-specific route and suggests an alternate OpenAI dialect when possible.
7. **Test prompt** — reserved for explicit test-prompt flows; routine profile verification skips it to avoid generating completions unexpectedly.

Results appear in the AIdome output channel with pass, warning, fail, or skipped status for each step plus actionable suggestions.

### Troubleshooting Common Issues

| Symptom | What to Check |
|---|---|
| `401 Unauthorized` or `403 Forbidden` | Update the profile token in **Manage Profiles** and confirm the token has access to the selected gateway or tenant. |
| DNS or connection timeout | Confirm the gateway host is reachable from the same environment where VS Code is running, including SSH, Dev Containers, Codespaces, or WSL. |
| TLS warning for an internal CA | Prefer installing the internal CA in the OS trust store. Disable `aidome-switchboard.advanced.tlsVerify` only for trusted internal endpoints. |
| Empty model list | Confirm the gateway exposes `/v1/models`, the profile dialect is correct, and the token can list models. |
| Claude Code shows no discovered gateway models | Confirm the gateway exposes Anthropic Messages semantics and that model IDs begin with `claude` or `anthropic` for Claude Code's gateway discovery path. |
| Assistant still uses the old endpoint | Run **Activate Profile** for the intended profile, then restart the affected assistant if it caches configuration. |

### Advanced Runtime Settings

For slower enterprise networks, proxies, or remote hosts, the extension exposes advanced tuning knobs under the VS Code settings prefix `aidome-switchboard.advanced.*`.

- Tune CLI detection, HTTP timeouts, retry backoff, cache TTL, log buffering, and verifier timeouts from the Settings UI or `settings.json`.
- Environment variables override the matching setting when present, which is useful for managed shells and automation. Common overrides include `HTTP_TIMEOUT_MS`, `AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS`, `AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS`, and `AIDOME_SWITCHBOARD_VERIFIER_*`.
- Keep the defaults unless you are troubleshooting proxy latency, certificate inspection, or remote reachability.

### TLS Certificate Verification

By default the extension verifies TLS certificates on every HTTPS request (including the 7-step verification pipeline). For enterprise gateways that use **self-signed or internal CA certificates**, you can disable strict verification:

```jsonc
// settings.json
"aidome-switchboard.advanced.tlsVerify": false
```

Or via environment variable (useful in CI/automation):
```bash
export AIDOME_SWITCHBOARD_TLS_VERIFY=false
```

> ⚠️ **Security Warning:** Disable TLS verification **only** for trusted internal endpoints. The default is `true` and should remain enabled for production and public-internet endpoints.

When verification is disabled, the verifier TLS step reports a **warning** instead of pass/fail so administrators can audit which endpoints skip certificate checks.

#### Assistant TLS Verification Support

Each AI assistant handles TLS verification differently. The table below summarises how to control TLS verification for each supported assistant (the full data is in `assistants.registry.json`):

| Support Level | Assistants | How to Disable |
|---|---|---|
| **Native** | Continue.dev | `requestOptions.rejectUnauthorized: false` in `config.json` per-model |
| **Env Var** | Claude Code | `ANTHROPIC_DISABLE_TLS_VERIFY=true` (TLS only; gateway routing uses `ANTHROPIC_BASE_URL`) |
| **Env Var** | Codex CLI | `CODEX_CA_CERTIFICATE` / `SSL_CERT_FILE` (custom CA only) |
| **Env Var** | AnythingLLM | `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| **VS Code Global** | GitHub Copilot, Cline, Roo Code, Kilo Code, CodeGPT, Tabnine | `"http.proxyStrictSSL": false` in VS Code settings |
| **None** | Gemini CLI | No documented TLS control |

---

## Generic Scanner

The extension includes a **generic settings scanner** for discovering unknown or future AI extensions:

- Uses heuristics to find settings keys in any extension
- Confidence scoring: **High** / **Medium** / **Low**
- Blocklist filtering to avoid false positives

Run **`AIdome: Setup Switchboard`** → Select "Scan for other AI extensions" to try it.

---

## FAQ

### Does this replace my AI assistant?

No. This is a configuration tool. You still need your AI assistants (Cline, Continue, etc.) installed.

### Does this send my code anywhere?

No. This extension is purely a configuration manager. It doesn't proxy, relay, or see any of your code or API traffic.

### What if my gateway goes down?

Your assistants will show connection errors. Use **`AIdome: Verify All Profile Routes`** to diagnose the issue.

### Can I use this without AIdome?

Yes! It works with any OpenAI-compatible gateway: LiteLLM, custom proxies, or any `/v1/chat/completions` endpoint.

### Does it work in remote environments (SSH, Containers, Codespaces)?

Yes. The extension detects remote environments and provides warnings if you configure a `localhost` endpoint that won't be reachable from the remote.

### What about GitHub Copilot?

Copilot is supported at **Tier B** using the proxy override mechanism:
- **Proxy Override** (`github.copilot.advanced.debug.overrideProxyUrl`): routes all Copilot REST traffic (inline completions + chat) through your gateway.

> ⚠️ **Note:** `debug.overrideProxyUrl` is an undocumented internal setting and may change or be removed in future Copilot updates. Verify after major Copilot extension updates.

This setting is applied automatically and is fully reversible.

---

## Not a Gateway — What This Extension IS and IS NOT

> ### 🚫 This Extension is NOT:
> - ❌ An LLM provider or model host
> - ❌ A proxy, gateway, or API relay
> - ❌ A replacement for any AI assistant
>
> ### ✅ This Extension IS:
> - ✅ A configuration manager for your existing AI tools
> - ✅ A way to point all your assistants to one approved endpoint
> - ✅ Enterprise-safe with encrypted secrets and full undo

---

## Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode.git
cd aidome-endpoint-switchboard-vscode

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Debug in VS Code
# Press F5 to launch Extension Development Host
```

### Testing

```bash
npm test          # Run all tests
npm run lint      # Check code style
npm run compile   # Build TypeScript
```

### Pull Request Guidelines

- Fork the repository and create a feature branch
- Write tests for new features
- Ensure all tests pass and code compiles
- Follow existing code style and conventions
- Submit PR with a clear description of changes

Report issues at: [GitHub Issues](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/issues)

---

## License

MIT License — see [LICENSE](LICENSE) file for details.

Copyright (c) 2026 AIdome

---

**Note**: This extension is a configuration tool for AI coding assistants. It is not affiliated with any specific AI assistant or LLM provider.
