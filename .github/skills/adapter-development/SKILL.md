---
name: adapter-development
description: >
  Use when adding support for a new AI coding assistant.
  Covers adapter implementation, registry updates, testing,
  and verification in the Extension Development Host.
---

# Skill: Adding a New AI Assistant Adapter

## When to Use

Invoke this skill when you need to add support for an AI coding assistant that is
not yet in the registry, or when upgrading an existing adapter from Tier 2 (guided)
to Tier 1 (full automatic configuration).

## Step 1 — Research the Assistant's Config Format

Before writing any code, understand how the assistant stores its configuration:

- Where is its config file? (home directory, VS Code extension storage, workspace?)
- What format does it use? (JSON, JSONC, TOML, YAML, INI?)
- Which field(s) control the endpoint base URL?
- How is authentication configured? (API key field, header, environment variable?)
- Does the assistant support multiple model providers or only one endpoint?

Check the assistant's official documentation and examine a real config file.
Note the exact field names — the adapter must write the assistant's native format
(ADR-002: Dialect-First Design).

## Step 2 — Add an Entry to the Assistant Registry

Add the new assistant to the registry JSON file that defines supported assistants.
Include at minimum:

- Unique ID (kebab-case, matches the adapter directory name)
- Display name (shown in the UI)
- Support tier (1 for full automatic, 2 for guided)
- Detection hints (extension ID, CLI command, or config file path pattern)
- Any dialect metadata needed by the adapter

Verify the registry still parses correctly after your addition:

```bash
npm run compile  # registry loader validates on compile
npm test         # registry tests check structure
```

## Step 3 — Create the Adapter Directory and Implement the Interface

Create a new directory for the adapter alongside the existing adapters.
Implement all methods of the adapter interface:

| Method | What to Implement |
|---|---|
| `detect()` | Check if the assistant's extension or CLI is present |
| `configure(profile)` | Read current config, backup, write updated endpoint settings |
| `verify()` | Confirm the endpoint is reachable and the assistant recognizes it |
| `reset()` | Restore the most recent backup |
| `getStatus()` | Return current configuration state (configured / unconfigured / error) |

Follow the backup-before-modify pattern in `configure()` — always backup before writing.
Use the safe filesystem utilities for all file operations, not raw `fs` calls.
Use the Logger class for all logging; never use `console.log`.
Validate the profile's URL before writing it to the config.

## Step 4 — Register the Adapter in the Adapter Index

Add the new adapter to the adapter registry/index so the orchestrator can find it.
The adapter ID must match the ID used in the registry JSON.

## Step 5 — Write Unit Tests

Create a test file for the new adapter. Cover:

- `detect()` returns `true` when the assistant is installed, `false` when not
- `configure(profile)` writes the correct fields in the correct format
- `configure(profile)` creates a backup before writing
- `configure(profile)` handles missing/corrupt existing config gracefully
- `verify()` returns success when endpoint responds, failure when it doesn't
- `reset()` restores from backup
- Error paths: invalid profile URL, filesystem permission denied, etc.

Mock the `vscode` module and filesystem using `vi.mock`. Do not require a running
VS Code instance for unit tests.

```bash
npm test -- path/to/newAssistantAdapter.test.ts  # Run just the new test file
npm test                                          # Run full suite to catch regressions
```

## Step 6 — Test in the Extension Development Host

Run the extension in development mode to test the full end-to-end flow:

1. Press **F5** in VS Code (or Run → Start Debugging)
2. In the new Extension Development Host window, install (or simulate) the target assistant
3. Run the "Setup Endpoint Switchboard" command
4. Verify the new assistant appears in the detection results
5. Apply a test profile and confirm the assistant's config file was updated correctly
6. Run "Verify Endpoint Routing" to confirm the assistant is routing through the endpoint
7. Run "Reset Switchboard" and confirm the original config is restored from backup

## Step 7 — Update Documentation

- Update `README.md` to mention the new assistant in the supported assistants section
- Update `CHANGELOG.md` with the new assistant support
- If the assistant required any architectural decisions, consider adding an ADR in `docs/adr/`

## Checklist

- [ ] Registry entry added and validated
- [ ] Adapter directory created with all interface methods implemented
- [ ] Backup-before-modify implemented in `configure()`
- [ ] No `console.log` — Logger class used throughout
- [ ] URL validation applied to the profile's base URL before writing
- [ ] Adapter registered in the adapter index
- [ ] Unit tests written and passing
- [ ] Tested in Extension Development Host (F5)
- [ ] README and CHANGELOG updated
