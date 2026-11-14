# Assistant Credential & Config Storage Reference

Where each assistant supported by the Switchboard persists its endpoint
configuration and its API token/credential — and how the Switchboard
updates them on profile activation.

Legend:

- **automatic** — Switchboard writes the credential on every profile apply
  (secret resolved from VS Code SecretStorage at apply time, never in logs/plans).
- **guided** — Switchboard cannot write it; the plan shows instructions.
- **ui-only** — the assistant only exposes it in its own UI.

| Assistant | Endpoint config file(s) | Credential location | How Switchboard sets it |
|---|---|---|---|
| **OpenAI Codex** (`openai-codex`) | `~/.codex/config.toml` (managed block `[model_providers.<providerName>]`) | `~/.codex/.env` → `OPENAI_API_KEY` (Codex loads `.env` once at process start; TOML keeps only the symbolic `env_key`) | **automatic** — `write-env-file` step, `secretPolicy: 'target-persisted-at-apply'`, `authRef = profile.authRef ?? profile.name`. Restart Codex/VS Code after activation (stale in-memory token otherwise). |
| **Claude Code** (`claude-code`) | `~/.claude/settings.json` → `env.ANTHROPIC_BASE_URL` | same file → `env.ANTHROPIC_AUTH_TOKEN` | **automatic** — `edit-config-file` (json-object driver) with `source: 'secret'` patch, `target-persisted-at-apply`. Old `env.ANTHROPIC_API_KEY` is removed. Restart running sessions to pick up a new token. |
| **Cline** (`cline`, ext `saoudrizwan.claude-dev`) | `~/.cline/data/settings/providers.json` → `providers["openai-compatible"].settings` (the settings-UI store; `apiKey` lives inside it); `~/.cline/data/globalState.json` → `openAiBaseUrl`, `planModeApiProvider`, `actModeApiProvider`, `plan/actModeOpenAiModelId`; `~/.cline/data/settings/models.json` → model catalog; `~/.cline/data/secrets.json` → `openAiApiKey` (**the runtime secret backing store**) | **BOTH are authoritative for different layers**: the settings UI reads/writes `providers.json`, but the task runtime resolves the request key via StateManager secrets (`openAiApiKey` → `secrets.json`) — verified from the 4.1.22 bundle (`persistSecretsBatch` → `ClineFileStorage(<dataDir>/secrets.json, mode 0600)`; `constructApiConfigurationFromCache()` → `getSecret("openAiApiKey")`) and Cline's own docs (.clinerules/storage.md: secrets live in `secrets.json`, mode 0600). | **automatic** — json-object driver patches BOTH stores from the profile secret (`target-persisted-at-apply`): `providers.openai-compatible.settings.apiKey` (settings UI) AND `secrets.json` `openAiApiKey` (runtime). Writing only one caused the "Token has been revoked" state after a rotation — the UI showed the fresh key while requests used the revoked one from the other store. Reload the Cline settings panel / window after apply; Cline keeps settings in memory. |
| **GitHub Copilot** (`github-copilot`) | VS Code settings (`github.copilot.advanced.*` proxy keys) | none (uses VS Code's Copilot auth; gateway handled via `overrideProxyUrl`) | **automatic** (settings step) — credential is Copilot's own auth; unregistered proxy setting is skipped with a warning when the extension is absent. |
| **Kilo Code** (`kilo-code`) | `~/.config/kilo/kilo.jsonc` (XDG_CONFIG_HOME-aware) | auth store referenced by the config (external) | **external** — descriptor marks apiKey `ui-only`; endpoint/model fields are written by the config patcher. |
| **Continue** (`continue`) | `~/.continue/config.yaml` (primary) + legacy `config.json` | `models[].apiKey` inside the same files (`array-entry`) | **external** per descriptor — endpoint/model synced; verify the key in Continue's UI if auth fails. |
| **Roo Code** (`roo-code`) | shares `~/.cline/data` style stores under its own data dir (`~/.roo/` when present) | own provider settings (same Cline lineage) | retired/best-effort — see `roo-retired` descriptor. |
| **Gemini CLI** (`gemini-cli`) | env binding (gateway env file) | `GEMINI_API_KEY` env | **guided** — plan shows the env var to set. |
| **CodeGPT** (`codegpt`) | UI-only (extension settings backed by its own storage) | its own UI | **ui-only / guided** — switchboard cannot write it; drift detection requires evidence. |
| **AnythingLLM** (`anythingllm`) | UI-only | its own UI | **ui-only / guided**. |
| **Tabnine** (`tabnine`) | enterprise config (`tabnine-enterprise` target) | enterprise policy store | **guided**. |

## Cross-cutting rules

1. **Profile secrets live in VS Code SecretStorage** (`aidome.switchboard.auth.<profileName>`). They are resolved only at apply time and never serialized into plans, logs, or change history.
2. **Credential steps use `secretPolicy: 'target-persisted-at-apply'`** so a rotated PAT is picked up on the next profile activation — but the profile's saved secret itself must be re-entered after a rotation (Switchboard → Edit profile → Auth Token).
3. **Backup-before-modify:** every `edit-config-file`/`write-env-file` writes a timestamped `.backup.*` next to the target first; rollback restores them.
4. **Cline dual stores:** when touching Cline, keep `providers.json`, `globalState.json`, `models.json`, AND `secrets.json` coherent (verification enforces URL equality and provider selection; the runtime key lives in `secrets.json` on 4.1.22 — newer Cline releases are migrating toward providers.json as the single source, per the cline/cline commit "modernize test config to use providers.json instead of legacy secrets.json").
5. **Codex special case:** Codex reads `~/.codex/.env` ONCE at process start — token rotation requires a Codex/VS Code restart, a new window is not enough.
6. **Dangerous URL schemes** (`javascript:`, `data:`, `file:`, `ftp:`) are rejected everywhere; plain-`http` self-hosted gateway URLs are valid.

Source of truth for machine-readable descriptors: `src/core/providerConfig/descriptors.ts`. Behavior reference per adapter: `.github/skills/adapter-development/SKILL.md`.
