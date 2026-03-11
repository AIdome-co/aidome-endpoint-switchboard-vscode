# Architecture Reference

Deep reference for the architectural patterns used in this extension.

## Adapter Pattern

The extension supports multiple AI coding assistants through a common adapter interface.
Each assistant has its own adapter that encapsulates its native config format and dialect.

**Interface contract** (conceptual — see the adapter interface type for exact signatures):

| Method | Responsibility |
|---|---|
| `detect()` | Check if the assistant is installed |
| `configure(profile)` | Write endpoint settings in the assistant's native format |
| `verify()` | Confirm the assistant is routed through the endpoint |
| `reset()` | Restore the original config (from backup) |
| `getStatus()` | Report current configuration state |

**Adding a new assistant**: create a new adapter directory, implement the interface,
and register the assistant in the registry JSON. The orchestrator discovers adapters
through the registry — no changes to orchestration code are needed for new assistants.

See `.github/skills/adapter-development/SKILL.md` for the step-by-step procedure.

## Profile System

Endpoint profiles allow users to switch between multiple AIdome gateway configurations.
A profile contains:

| Field | Storage |
|---|---|
| Profile name | `globalState` |
| Base URL | `globalState` |
| Dialect | `globalState` |
| Auth scheme | `globalState` |
| API key / token | `SecretStorage` |
| Tenant ID | `SecretStorage` (if sensitive) |

The profile store coordinates reads/writes across both storage tiers. The profile
validator checks URLs, names, and required fields before a profile is saved or applied.

## Orchestration Flow

The switchboard orchestrator coordinates all configuration work:

```
Detection → Plan → Apply → Verify
```

1. **Detection** — Scan for installed AI assistant extensions and CLI tools.
   Detect the VS Code environment type (local, remote, WSL, container).
2. **Plan** — For each detected assistant, determine what config changes are needed
   based on the active profile. Produce a change plan without writing anything.
3. **Apply** — Execute the plan: backup existing configs, then write new configs
   through each adapter. Record changes in the change log.
4. **Verify** — Confirm that each configured assistant can reach the endpoint.
   Surface any connectivity problems via notifications.

This separation means the plan can be previewed before applying, and failures during
apply do not leave partial state (backups are created first).

## Registry System

The assistant registry is a JSON file that defines all supported assistants. Each entry
includes the assistant's ID, display name, support tier, and metadata needed for detection
and adapter loading.

**Support tiers**:
- **Tier 1 (Full)** — Complete adapter with automatic configuration
- **Tier 2 (Guided)** — Instructions provided; user performs manual steps (ADR-004)

The registry loader reads this file at extension activation and makes it available to
the detection and orchestration layers. Adapters are matched to registry entries by ID.

## Architecture Decision Records (ADRs)

The project maintains formal ADRs for key architectural decisions:

| ADR | Decision | Rationale |
|---|---|---|
| ADR-001 | Profiles over flat base URL | Support multiple environments; switch without reconfiguring |
| ADR-002 | Dialect-first design | Write config in each assistant's native format, not a normalized form |
| ADR-003 | Backup-before-modify | Guarantee recoverability; never lose user's existing config |
| ADR-004 | Guided tier for unsupported | Better UX than silent failure for assistants without full adapters |

When making architectural changes, check whether an existing ADR is affected and
update or supersede it if needed.

## UI Patterns

| Pattern | When to Use |
|---|---|
| Wizard flow | Multi-step user interactions (setup, profile creation) |
| `showErrorMessage` / `showInformationMessage` | Short user-facing messages and prompts |
| Output channel | Detailed logs visible in VS Code "Output" panel |
| Status bar item | Persistent at-a-glance status (current profile, routing state) |
| Diagnostics view | Rich structured output for support and troubleshooting |

The UI layer never calls adapters directly. It goes through the orchestrator or the
appropriate core module. UI components receive data — they do not fetch it themselves.
