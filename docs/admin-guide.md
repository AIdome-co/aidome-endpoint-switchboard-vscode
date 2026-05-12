# Administrator Guide

## Setting Up Profiles for Your Organization

### Recommended Profile Configuration

| Field | Example | Notes |
|-------|---------|-------|
| Name | `production` | Use environment names |
| Base URL | `https://llm-gateway.yourorg.com` | Your LLM gateway endpoint |
| Dialect | `openai.chat_completions` | Most common for OpenAI-compatible gateways |
| Auth | (via SecretStorage) | API key for your gateway |
| Tenant | `engineering-team` | Optional org/team identifier |

### Per-Assistant Recommendations

| Assistant | Recommended Setup | Notes |
|-----------|-------------------|-------|
| Continue.dev | Tier A — auto-configure | Patches `~/.continue/config.json` |
| Cline | Tier A — auto-configure | Sets VS Code settings |
| Roo Code | Tier A — auto-configure | Sets VS Code settings |
| Kilo Code | Tier A — auto-configure | Sets VS Code settings |
| Codex CLI | Tier A — auto-configure | Patches `~/.codex/config.toml` or env vars |
| CodeGPT | Tier B — verify after | May need manual model selection |
| Others | Tier C — guided | Follow OutputChannel instructions |

## Tuning Advanced Runtime Settings

For high-latency enterprise gateways, proxy chains, or remote development hosts, tune the extension's advanced runtime settings under `aidome-switchboard.advanced.*`.

- Raise `aidome-switchboard.advanced.httpTimeoutMs` and `aidome-switchboard.advanced.verifier.*` when TLS inspection, health checks, or model-list probes need more time.
- Raise `aidome-switchboard.advanced.cliDetectionTimeoutMs` if developer shells resolve assistant CLIs from slower network-mounted or remote filesystems.
- Use environment variable overrides in managed terminals, remote sessions, or CI when VS Code settings are not the right control plane. Common overrides include `HTTP_TIMEOUT_MS`, `AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS`, `AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS`, and `AIDOME_SWITCHBOARD_VERIFIER_*`.
- Leave cache and log-buffer defaults in place unless you have a specific operational need to shorten capability refreshes or retain fewer diagnostics entries.

## Troubleshooting

### Proxy Issues

**Symptom**: "Connection timed out" or "Proxy error" in verification

**Solution**: 
```bash
export HTTPS_PROXY=http://proxy.yourorg.com:8080
export NO_PROXY=localhost,127.0.0.1
```

### DNS Resolution

**Symptom**: "Cannot resolve hostname" in verification

**Solution**: Ensure the gateway hostname is resolvable from the developer's machine. For internal DNS, verify VPN connection.

### Self-Signed Certificates

**Symptom**: "TLS certificate error" or "DEPTH_ZERO_SELF_SIGNED_CERT" in verification

**Solutions** (in order of preference):

1. **Add the CA to the system trust store** — the most secure option.
2. **Point Node.js to the CA bundle**:
   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/ca.pem
   ```
3. **Disable TLS verification for this extension only** (use for trusted internal endpoints):
   ```jsonc
   // settings.json
   "aidome-switchboard.advanced.tlsVerify": false
   ```
   Or via environment variable:
   ```bash
   export AIDOME_SWITCHBOARD_TLS_VERIFY=false
   ```

> ⚠️ When `tlsVerify` is `false`, the verifier TLS step reports a **warning** so the configuration is auditable.

**Per-assistant TLS overrides:**

If individual assistants also reject TLS connections, configure them separately:

| Assistant | Override |
|-----------|----------|
| Continue.dev | `requestOptions.rejectUnauthorized: false` in `config.json` |
| Claude Code | `ANTHROPIC_DISABLE_TLS_VERIFY=true` (TLS only; gateway routing uses `ANTHROPIC_BASE_URL`) |
| Codex CLI | `CODEX_CA_CERTIFICATE=/path/to/ca.pem` |
| AnythingLLM | `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| VS Code extensions (Cline, Roo Code, Kilo Code, CodeGPT, Copilot, Tabnine) | `"http.proxyStrictSSL": false` in settings |
| Gemini CLI | No TLS control available |

### Remote Development

**Symptom**: "localhost" endpoint unreachable in SSH/Container

**Solution**: Use the remote host's IP or hostname instead of `localhost`. The extension warns about this automatically.

### Firewall Blocking

**Symptom**: "Connection refused" in verification

**Solution**: Ensure the gateway port is open in your firewall. Default ports: 443 (HTTPS), 8080 (HTTP dev).

## Common Configuration Patterns

### Pattern 1: Single Gateway for All Assistants

All assistants point to the same gateway endpoint:

- Base URL: `https://gateway.yourorg.com`
- Dialect: `openai.chat_completions`
- All Tier A assistants auto-configured

### Pattern 2: Different Gateways by Team

Create multiple profiles:

- `team-a-prod` → `https://team-a-gateway.yourorg.com`
- `team-b-prod` → `https://team-b-gateway.yourorg.com`

Users select the appropriate profile via "Manage Profiles"

### Pattern 3: Development vs Production

Maintain separate profiles:

- `dev` → `http://localhost:8080` (local gateway)
- `production` → `https://gateway.yourorg.com`

Switch between them as needed.

## Security Best Practices

1. **Never share API keys** — Each user should have their own key
2. **Use short-lived tokens** — Rotate keys regularly
3. **Monitor access logs** — Track gateway usage
4. **Review diagnostics exports** — Verify secret redaction works
5. **Test in dev first** — Validate configuration before production use

## Support Escalation

If users encounter issues:

1. Run **"AIdome: Export Diagnostics"**
2. Share the redacted JSON report with your support team
3. Check gateway logs for connection attempts
4. Verify network connectivity with `curl` or `wget`

Example verification:
```bash
curl -v https://gateway.yourorg.com/health
```
