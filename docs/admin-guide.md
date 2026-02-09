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

**Symptom**: "TLS certificate error" in verification

**Solution**: 
- Add the CA certificate to your system's trust store
- For Node.js: set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`

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
