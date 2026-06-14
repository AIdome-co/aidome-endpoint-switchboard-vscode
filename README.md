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

### Before You Begin

Have these values ready before running the wizard:

| Value | Why it matters | Example |
|-------|----------------|---------|
| Gateway base URL | The endpoint each assistant should call after configuration; confirm whether your gateway expects the base URL to include `/v1` | `https://llm-gateway.yourorg.com/v1` |
| Dialect | The API protocol exposed by that gateway front door | `openai.chat_completions` |
| API token | Profile secrets are stored in VS Code SecretStorage. Most assistant configuration avoids plain-text token storage where possible; Claude Code Tier A is an explicit exception noted below. | `aidome_...` |
| Tenant/team identifier | Optional org, tenant, or team routing value when your gateway requires one | `engineering-team` |
| Target assistants | Install the assistants you want routed before detection so the wizard can find and assign them | Continue, Cline, Codex CLI |

> Tip: for most OpenAI-compatible gateways, choose **Auto-detect** or `openai.chat_completions`. Auto-detect currently selects the default dialect for profile creation; it does not probe or mutate your gateway.

### 1. Install the Extension

Install from the VS Code Marketplace or download the `.vsix` from [GitHub Releases](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/releases).

### 2. Run the Setup Wizard

1. Open Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
2. Run: **`AIdome: Setup Endpoint Switchboard`**
3. Follow the wizard:
   - Detect installed assistants
   - Create an endpoint profile
   - Apply configuration
   - Verify connectivity ✅

### 3. Start Coding

Assigned assistants now route through the approved endpoint. Restart or reload assistants that cache configuration, and run **AIdome: Assign Assistants to Profile** when you install or add assistants later.

### Day-to-Day Workflow

- Use **AIdome: Activate Profile** when switching between development, staging, and production gateways. Activation reapplies automated assistant mappings for the selected profile.
- Use **AIdome: Show Models & Providers** after a gateway change to confirm the model inventory visible to the active profile.
- Use **AIdome: Verify All Profile Routes** before filing support tickets; it checks local profile data, DNS, TLS, reachability, optional health endpoints, model listing, and dialect compatibility.
- Use **AIdome: Reset Switchboard** only when you intentionally want to remove Switchboard-managed changes and restore backups.

---

## Commands

All commands available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description | When to use it |
|---------|-------------|----------------|
| `AIdome: Setup Endpoint Switchboard` | Launches the setup wizard to create a profile, detect assistants, assign them, and apply configuration. | First-time setup or a guided reconfiguration. |
| `AIdome: Verify All Profile Routes` | Runs the verification pipeline across configured profile routes. | Before support escalation or after gateway, proxy, certificate, or assistant changes. |
| `AIdome: Show Models & Providers` | Fetches the model/provider inventory for the active or selected profile. | Confirm the gateway exposes the expected models without sending a prompt. |
| `AIdome: Manage Profiles` | Creates, edits, deletes, inspects, and switches profiles. | Maintain development, staging, production, or team-specific endpoints. |
| `AIdome: Assign Assistants to Profile` | Chooses which detected assistants should use a profile. | Add newly installed assistants or keep experimental tools off production routes. |
| `AIdome: Activate Profile` | Switches the active profile and reapplies automated assistant mappings. | Move assigned assistants between approved endpoints. |
| `AIdome: Reset Switchboard` | Removes Switchboard-managed changes and restores available backups. | Roll back configuration intentionally. |
| `AIdome: Export Diagnostics` | Writes a redacted diagnostic report for support. | Share route, environment, and adapter state without exposing secrets. |
| `AIdome: Refresh` | Refreshes the Assistants view detection state. | Re-scan after installing, uninstalling, or updating assistants. |

---

## Verification Pipeline

Run **AIdome: Verify All Profile Routes** after setup, profile activation, gateway changes, certificate updates, or assistant upgrades. Routine verification is designed to inspect routing and metadata; it should not generate completions unexpectedly unless you choose an explicit test-prompt flow.

The verifier reports each route through these checks:

| Step | What it checks | Typical action if it fails |
|------|----------------|----------------------------|
| DNS resolution | The gateway hostname resolves from the current local or remote VS Code context. | Check VPN, split DNS, `/etc/hosts`, or remote-host DNS. |
| TLS verification | The certificate chain is trusted when HTTPS is used. | Install the private CA or use approved TLS override settings for internal endpoints. |
| Endpoint reachability | The gateway accepts a network connection within configured timeouts. | Check firewall, proxy, port, and gateway availability. |
| Optional health endpoint | A configured health URL responds when your gateway exposes one. | Confirm the health path and expected status with gateway admins. |
| Model list / providers | The gateway exposes model/provider inventory for the profile. | Check token scope, model allowlists, and gateway model aliases. |
| Dialect validation | The selected dialect matches the gateway front door and assistant expectations. | Pick the matching dialect or publish a compatible gateway route. |
| Optional test prompt | Sends a deliberate prompt only when an explicit test-prompt flow is requested. | Use only when you need end-to-end completion validation. |

---

## Troubleshooting

| Symptom | Likely cause | What to try |
|---------|--------------|-------------|
| `401` or `403` during verification or model discovery | Missing, expired, or under-scoped gateway token. | Update the profile token through the wizard or profile flow so it is stored in SecretStorage, then rerun **AIdome: Verify All Profile Routes**. |
| DNS failure or timeout | Hostname is not reachable from the current machine, SSH host, WSL distro, Dev Container, or Codespace. | Confirm VPN/DNS, proxy variables, firewall rules, and whether `localhost` should be replaced with a reachable hostname. |
| TLS or private-CA warning | The gateway certificate is self-signed or issued by an internal CA. | Trust the CA with the OS/Node.js, or use documented TLS overrides only for approved internal endpoints. |
| Empty model list | The gateway hides models for this token, route, tenant, or dialect. | Check model allowlists, tenant/team routing, `/v1` path expectations, and provider aliases. |
| Dialect mismatch | The profile dialect does not match the gateway front door. | Use the dialect exposed by the gateway; Claude Code needs an Anthropic Messages-compatible front door. |
| Claude Code model discovery issues | Claude Code filters gateway-discovered models and only uses discovery on supported Anthropic Messages gateways. | Ensure the gateway exposes Anthropic Messages semantics, enables Claude-compatible model aliases, and that Claude Code is restarted/reloaded if it cached settings. |
| Assistant still uses the old endpoint after activation | The assistant cached configuration or was not assigned to the active profile. | Restart/reload the assistant, run **AIdome: Assign Assistants to Profile**, then run **AIdome: Activate Profile** again. |

---

## Enterprise Safety

This extension is designed for enterprise environments with strict security requirements:

- 🔒 **SecretStorage**: Profile secrets are stored via VS Code's encrypted SecretStorage API; most assistant configuration avoids plain-text token storage where possible. Claude Code Tier A is an explicit exception: profile activation writes the active token to `env.ANTHROPIC_AUTH_TOKEN` in the shared Claude Code settings file because Claude Code reads auth from that environment setting.
- 📊 **No Telemetry**: Zero data collection. All processing is local.
- 💾 **Backup Before Modify**: Timestamped backups created before any configuration change
- 📋 **Audit Trail**: Full change log with undo capability. Export redacted diagnostics for support.
- 🔐 **Secret Redaction**: Diagnostics reports automatically redact all auth tokens, API keys, and sensitive data
- 🌐 **Remote Aware**: Detects SSH, Dev Containers, Codespaces, WSL — warns about reachability issues
- ↩️ **Full Undo**: Every change can be reversed. Factory reset available with confirmation.

---

## Documentation Map

- [Administrator Guide](docs/admin-guide.md) — rollout checklist, user setup runbook, troubleshooting, and support escalation.
- [Enterprise Installation Guide](docs/enterprise-install.md) — recommended rollout, pre-install requirements, Settings Sync, SecretStorage, proxy, and certificate guidance.
- [Platform Support](docs/platform-support.md) — supported operating systems and remote VS Code contexts.
- [Architecture Reference](.github/references/architecture.md) — extension architecture, adapter boundaries, and design notes.

---

## Configuration

### Profiles

Profiles store your endpoint configuration:

- **Name**: Human-readable identifier (e.g., "Production", "Staging")
- **Base URL**: Your LLM gateway endpoint (e.g., `https://gateway.yourorg.com`)
- **Dialect**: API protocol type (e.g., `openai.chat_completions`)
- **Auth**: API key (profile secret stored in SecretStorage; Claude Code Tier A also receives the active token in `env.ANTHROPIC_AUTH_TOKEN` during profile activation)
- **Tenant** (optional): Organization or team identifier

Profiles are stored in VS Code's `globalState` and persist across sessions. API tokens are stored separately in VS Code SecretStorage.

### What the Switchboard Changes

When you apply a profile, the extension only changes configuration surfaces for selected assistants:

| Surface | Examples | Safety behavior |
|---------|----------|-----------------|
| VS Code settings | Cline, Roo Code, Kilo Code, CodeGPT, Copilot proxy override | Settings are applied through the VS Code configuration API where supported |
| User config files | Continue `config.json`, Codex CLI `config.toml`, Claude Code `settings.json` | A timestamped backup is created before modification |
| Environment hints | Assistant-specific TLS or gateway variables documented in guided output | Secrets are redacted in logs and diagnostics |

The extension does **not** modify source code, workspace files, prompts, or assistant conversation history.

### Managing Profiles

Use **`AIdome: Manage Profiles`** to:
- Create new profiles
- Edit existing profiles
- Delete profiles
- Switch between profiles

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

Run **`AIdome: Setup Endpoint Switchboard`** → Select "Scan for other AI extensions" to try it.

---

## FAQ

### Does this replace my AI assistant?

No. This is a configuration tool. You still need your AI assistants (Cline, Continue, etc.) installed.

### Does this send my code anywhere?

No. This extension is purely a configuration manager. It doesn't proxy, relay, or see any of your code or API traffic.

### What if my gateway goes down?

Your assistants will show connection errors. Use **`AIdome: Verify All Profile Routes`** to diagnose the issue. If you have a fallback gateway, create a second profile and use **`AIdome: Activate Profile`** to switch assistants to it.

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
