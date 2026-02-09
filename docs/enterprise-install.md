# Enterprise Installation Guide

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

The extension stores profiles in VS Code's `globalState`, which is not synced via Settings Sync by default. This is by design — endpoint configurations should be environment-specific.

### Proxy Configuration

If your organization uses an HTTP proxy, set the `HTTPS_PROXY` environment variable. The extension respects this for all outbound HTTP requests.

```bash
export HTTPS_PROXY=http://proxy.yourorg.com:8080
export NO_PROXY=localhost,127.0.0.1
```

## Security Posture

- **No telemetry**: Zero data collection
- **Local processing only**: All configuration is done locally
- **SecretStorage**: Auth tokens encrypted via VS Code's native SecretStorage API
- **Audit trail**: Full change log available via "Export Diagnostics"
- **Reversible**: All changes can be undone via "Reset Switchboard"

## Org-Wide Default Profiles

Currently, profiles are per-user (stored in globalState). For org-wide defaults:

1. Distribute a profile configuration document to your team
2. Each user creates the profile via the wizard
3. Use "Export Diagnostics" to verify consistent configuration

Future versions may support `.aidome-profile.json` workspace files for team-shared configurations.

## Firewall & Network Requirements

The extension makes HTTPS requests to:
- Your configured LLM gateway endpoint (for verification and model discovery)

**Required ports**:
- **443** (HTTPS) — for secure gateway communication
- **8080** (HTTP) — optional, for development/testing gateways

Ensure your firewall rules allow outbound connections to your gateway endpoint.
