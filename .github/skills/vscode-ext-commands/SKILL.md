---
name: vscode-ext-commands
description: >
  Use when adding or updating VS Code command contributions in the AIdome
  Endpoint Switchboard extension. Covers naming conventions, package.json
  contributions, command handler registration, and the thin-wrapper pattern.
---

# Skill: VS Code Extension Command Contribution

## When to Use

Invoke this skill when you need to:
- Add a new command to the extension
- Update an existing command's title, category, or icon
- Register a command handler in the activation function
- Add a command to menus, context menus, or the status bar
- Understand the thin-wrapper command handler pattern used in this extension

## Project Context

The AIdome Endpoint Switchboard extension registers commands that let users:
- Set up endpoint routing for AI assistants
- Select and apply endpoint profiles
- Verify endpoint connectivity
- Reset assistant configurations to backups
- Export diagnostics

All commands follow the **thin-wrapper pattern**: command handlers contain no
business logic. They delegate immediately to the core orchestrator or UI layer.

## Step 1 — Define the Command in `package.json`

Add the command to the `contributes.commands` array:

```json
{
  "command": "aidome-switchboard.myNewCommand",
  "title": "My New Command",
  "category": "AIdome Switchboard"
}
```

### Naming Conventions

- **Command ID**: `aidome-switchboard.<camelCaseAction>` — always prefixed with
  the extension's activation event prefix
- **Title**: Human-readable, action-oriented — "Setup Endpoint Routing", not
  "Endpoint Router Setup"
- **Category**: Always `"AIdome Switchboard"` — groups commands in the palette

### Optional Properties

| Property | When to Use |
|---|---|
| `icon` | Command appears in sidebar, title bar, or toolbar |
| `enablement` | Command should be disabled in certain contexts |
| `when` | Command should be hidden from the palette conditionally |

## Step 2 — Register the Command Handler

In the extension's activation function, register the handler:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand(
    'aidome-switchboard.myNewCommand',
    async () => {
      // Thin wrapper — delegate to orchestrator or UI
      await orchestrator.handleMyNewAction();
    }
  )
);
```

### Thin-Wrapper Rules

- **No business logic** in the handler — delegate immediately
- **No adapter calls** from command handlers — go through the orchestrator
- **Error handling**: Catch errors and show user-friendly messages via
  `vscode.window.showErrorMessage`. Log full details via the Logger class.
- **No `console.log`** — use the Logger class for all output

```typescript
// ❌ WRONG — business logic in command handler
vscode.commands.registerCommand('aidome-switchboard.setup', async () => {
  const installed = await detectInstalledAssistants();
  for (const assistant of installed) {
    await assistant.configure(currentProfile);
  }
});

// ✅ CORRECT — thin wrapper delegates to orchestrator
vscode.commands.registerCommand('aidome-switchboard.setup', async () => {
  try {
    await orchestrator.runSetupFlow();
  } catch (error) {
    logger.error('Setup flow failed', error);
    vscode.window.showErrorMessage('Endpoint setup failed. Check the output channel.');
  }
});
```

## Step 3 — Add to Menus (Optional)

### Command Palette

Commands appear in the palette by default. To hide a command from the palette
(e.g., a sidebar-only action), add a `when` clause:

```json
{
  "command": "aidome-switchboard._sidebarAction#sideBar",
  "when": "false"
}
```

### Editor Title / Context Menu

Add to `contributes.menus` in `package.json`:

```json
"menus": {
  "commandPalette": [
    {
      "command": "aidome-switchboard.myNewCommand",
      "when": "aidome-switchboard.hasActiveProfile"
    }
  ]
}
```

## Step 4 — Add Keybinding (Optional)

```json
"keybindings": [
  {
    "command": "aidome-switchboard.myNewCommand",
    "key": "ctrl+shift+a",
    "mac": "cmd+shift+a",
    "when": "aidome-switchboard.isActive"
  }
]
```

## Step 5 — Test the Command

### Unit Test

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn(),
  },
  window: {
    showErrorMessage: vi.fn(),
  },
}));

describe('myNewCommand', () => {
  it('should delegate to orchestrator', async () => {
    const orchestratorSpy = vi.spyOn(orchestrator, 'handleMyNewAction');
    await commandHandler();
    expect(orchestratorSpy).toHaveBeenCalled();
  });
});
```

### Manual Test

1. Press **F5** to launch the Extension Development Host
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Type "AIdome Switchboard" to see all extension commands
4. Run the new command and verify the expected behavior
5. Check the Output channel for log messages

## Checklist

- [ ] Command ID follows `aidome-switchboard.<camelCaseAction>` convention
- [ ] Title is human-readable and action-oriented
- [ ] Category is `"AIdome Switchboard"`
- [ ] Command registered in `package.json` → `contributes.commands`
- [ ] Handler registered in activation function with `subscriptions.push`
- [ ] Handler follows thin-wrapper pattern — no business logic
- [ ] Error handling shows user-friendly message via `showErrorMessage`
- [ ] Logger used for all output — no `console.log`
- [ ] Unit test written for the command handler
- [ ] Tested in Extension Development Host (F5)
