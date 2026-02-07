# LLM Endpoint Switchboard (by AIdome)

> Enterprise-grade LLM endpoint routing for VS Code AI coding assistants

## Overview

The **LLM Endpoint Switchboard** is a VS Code extension that helps you configure multiple AI coding assistants to use custom LLM endpoints, including enterprise gateways like AIdome. This extension is **NOT a gateway itself** — it's a configuration management tool that helps you route your existing AI assistants to your chosen endpoints.

### What This Extension Does

- 🔍 **Detects** installed AI coding assistants in your VS Code environment
- ⚙️ **Configures** assistants to use custom LLM endpoints (AIdome or any OpenAI-compatible gateway)
- 🔐 **Manages** profiles for different environments (dev, staging, production)
- ✅ **Verifies** endpoint routing is working correctly
- 🛡️ **Enterprise-safe** configuration without storing secrets in plain text

### What This Extension Does NOT Do

- ❌ This is **NOT an LLM gateway** — it doesn't proxy or route API requests itself
- ❌ This is **NOT an AI assistant** — you still need Cline, Continue, Copilot, etc.
- ❌ This is **NOT required** — you can configure assistants manually if you prefer

## Supported Assistants

| Assistant | Tier | Dialect | Configuration Method | Notes |
|-----------|------|---------|---------------------|-------|
| **Cline** | A | OpenAI Chat Completions | VS Code Settings | Full automated configuration |
| **Roo Code** | A | OpenAI Chat Completions | VS Code Settings | Full automated configuration |
| **Kilo Code** | A | OpenAI Chat Completions | VS Code Settings | Full automated configuration |
| **Continue.dev** | A | OpenAI Chat Completions | Config File (YAML) | File-based with backup |
| **OpenAI Codex** | A | OpenAI Responses | Config File (TOML) | CLI tool configuration |
| **CodeGPT** | B | OpenAI Chat Completions | Guided Setup | In-app configuration guidance |
| **AnythingLLM** | B | OpenAI Chat Completions | Guided Setup | Desktop app guidance |
| **Claude Code** | C | Anthropic Messages | Guided Only | Limited endpoint switching |
| **Gemini CLI** | C | Google Gemini | Guided Only | No base URL override |
| **Tabnine** | C | Proprietary | Guided Only | Enterprise server only |
| **GitHub Copilot** | C | Proprietary | Guided Only | No endpoint switching support |

### Tier Definitions

- **Tier A**: Full automation — extension can detect, configure, and verify automatically
- **Tier B**: Partial automation — extension provides guided setup with manual steps
- **Tier C**: Guidance only — extension detects and explains limitations, suggests alternatives

## Enterprise Safety Posture

This extension is designed with enterprise security in mind:

- ✅ **No secrets in source code** — API keys stored in VS Code's SecretStorage
- ✅ **Automatic backups** — All configuration changes backed up before modification
- ✅ **Audit trail** — Comprehensive logging of all configuration changes
- ✅ **Rollback support** — Easy restoration of previous configurations
- ✅ **Redacted diagnostics** — Exported diagnostics automatically redact sensitive data
- ✅ **No telemetry** — Extension does not send usage data anywhere

## Getting Started

### Installation

1. Install from VS Code Marketplace: `AIdome Endpoint Switchboard`
2. Or install from VSIX: `code --install-extension aidome-endpoint-switchboard-*.vsix`

### Quick Start

1. **Run Setup Wizard**
   - Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   - Run: `AIdome: Setup Endpoint Switchboard`
   - Follow the interactive wizard

2. **Configure Your Profile**
   - Enter your AIdome endpoint URL (or any OpenAI-compatible gateway)
   - Provide your API key (stored securely)
   - Select which assistants to configure

3. **Verify Configuration**
   - Run: `AIdome: Verify Endpoint Routing`
   - Check that all assistants are properly routed

4. **Start Coding**
   - Your AI assistants now use your custom endpoint
   - No additional changes needed

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Setup Endpoint Switchboard** — Launch the setup wizard
- **Verify Endpoint Routing** — Check current routing configuration
- **Show Models & Providers** — View available models from active profile
- **Manage Profiles** — Create, edit, and switch between profiles
- **Reset Switchboard** — Clear all configuration and start over
- **Export Diagnostics** — Generate troubleshooting report

## Configuration

### Profiles

Profiles let you manage multiple endpoint configurations:

```json
{
  "name": "Production",
  "baseUrl": "https://gateway.example.com",
  "mappings": [
    {
      "assistantKey": "cline",
      "endpointUrl": "https://gateway.example.com/v1/chat/completions",
      "modelName": "gpt-4"
    }
  ]
}
```

### Dialects

The extension understands multiple LLM API dialects:

- **OpenAI Chat Completions** (`/v1/chat/completions`)
- **OpenAI Responses** (`/v1/responses`)
- **Anthropic Messages** (`/v1/messages`)
- **Google Gemini** (generateContent)
- **Proprietary** (GitHub Copilot, Tabnine)

## Troubleshooting

### Assistant Not Detected

- Ensure the assistant extension is installed and enabled
- Restart VS Code after installing new assistants
- Check Extension view to verify installation

### Configuration Not Applied

- Run `AIdome: Verify Endpoint Routing` to check status
- Check VS Code settings for the specific assistant
- Review logs in Output panel: `AIdome Switchboard`

### Endpoint Not Reachable

- Verify endpoint URL is correct and accessible
- Check firewall/proxy settings
- Test endpoint with `curl` or similar tool
- Review API key validity

### Export Diagnostics

For support, export diagnostics:

1. Run `AIdome: Export Diagnostics`
2. Share the generated JSON (sensitive data is redacted)

## Links

- [Documentation](https://docs.aidome.io/switchboard)
- [GitHub Repository](https://github.com/aidome/aidome-endpoint-switchboard-vscode)
- [Issue Tracker](https://github.com/aidome/aidome-endpoint-switchboard-vscode/issues)
- [AIdome Platform](https://aidome.io)

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support

- 📧 Email: support@aidome.io
- 💬 Discord: [AIdome Community](https://discord.gg/aidome)
- 📖 Docs: [docs.aidome.io](https://docs.aidome.io)

---

**Note**: This extension is provided as-is for configuring AI coding assistants to use custom endpoints. It is not affiliated with any specific AI assistant or LLM provider.
