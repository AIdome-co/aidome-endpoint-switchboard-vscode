# ADR-003: Backup Before Modify

## Status
Accepted

## Context
The extension modifies configuration files for AI assistants (settings.json, config.toml, .continue/config.json, etc.). These modifications could fail, corrupt files, or produce undesired results. We need a safety mechanism for users to recover their original configurations.

## Decision
We create timestamped backups of all configuration files before modifying them, and provide automatic rollback on failure plus manual recovery instructions when rollback fails.

## Rationale

### Why Backups?

1. **User trust**: Modifying user configuration files is invasive. Backups provide assurance that nothing is permanent and mistakes can be undone.

2. **Failure recovery**: If file write fails mid-operation (disk full, permission error, OS crash), we can restore from backup automatically.

3. **Rollback capability**: If verification fails after applying changes, we can automatically revert all modifications to their previous state.

4. **Debugging**: Backups allow users to diff before/after states when troubleshooting issues.

5. **Audit trail**: Timestamped backups create a history of configuration changes.

### Backup Strategy

**File naming**:
```
original: /path/to/config.json
backup:   /path/to/config.json.backup.2026-02-09T15-30-45-123Z
```

**Timestamp format**: ISO 8601 with colons/dots replaced by hyphens for filesystem compatibility.

**Storage location**: Same directory as original file (easy to find, no permission issues).

**Retention**: We don't auto-delete backups. Users can clean them up manually. This is intentional - better to have too many backups than accidentally delete the one you need.

### Automatic Rollback

When applying a configuration plan, if any step fails:

1. Log the error with details
2. Iterate through applied steps in reverse order
3. For each step, attempt to restore from backup:
   - If backup exists, copy it back to original location
   - If no backup, use oldValue from change log
   - If both unavailable, log manual recovery instructions
4. Report success/failure of rollback to user
5. Show output panel with recovery instructions if rollback fails

### Manual Recovery

When automatic rollback fails (file locked, permissions changed, disk issues), we provide detailed manual recovery instructions:

```
Failed to automatically rollback: edit-config-file on /Users/alice/.continue/config.json

Manual recovery steps:
1. Locate backup file: /Users/alice/.continue/config.json.backup.2026-02-09T15-30-45-123Z  
2. Restore to: /Users/alice/.continue/config.json
3. Command: cp "/Users/alice/.continue/config.json.backup.2026-02-09T15-30-45-123Z" "/Users/alice/.continue/config.json"
```

This gives users a clear path forward even in worst-case scenarios.

### Symlink Handling

Before backing up, we resolve symlinks using `fs.realpath()`. This ensures we back up the actual file, not just the symlink, preventing issues with dangling symlinks or circular references.

## Consequences

### Positive
- User confidence in extension safety
- Automatic recovery from failures
- Clear manual recovery when automation fails
- Debugging support via backup history
- Rollback enables experimentation without fear

### Negative
- Backup files accumulate (user must clean up manually)
- Extra disk I/O for backup operations
- Backup can fail if disk is full/permissions insufficient
- Symlink resolution adds complexity

## Implementation Notes

Backup creation:
```typescript
// src/util/fsSafe.ts
export async function createBackup(filePath: string): Promise<string | undefined> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Resolve symlinks before backup
  let realPath = filePath;
  try {
    realPath = await fs.realpath(filePath);
  } catch {
    // If realpath fails, use original path
  }
  
  const backupPath = `${realPath}.backup.${timestamp}`;
  await fs.copyFile(realPath, backupPath);
  return backupPath;
}
```

Rollback logic:
```typescript
// src/core/orchestration/applier.ts  
private async rollbackSteps(steps: AppliedStep[]): Promise<void> {
  for (let i = steps.length - 1; i >= 0; i--) {
    try {
      await this.reverseStep(steps[i]);
    } catch (error) {
      // Show manual recovery instructions
      const step = steps[i];
      let recoveryMessage = `Failed to automatically rollback: ${step.type} on ${step.target}\n`;
      
      if (step.backupPath) {
        recoveryMessage += `\nManual recovery steps:\n`;
        recoveryMessage += `1. Locate backup file: ${step.backupPath}\n`;
        recoveryMessage += `2. Restore to: ${step.target}\n`;
        recoveryMessage += `3. Command: cp "${step.backupPath}" "${step.target}"`;
      }
      
      this.logger.error(recoveryMessage);
      vscode.window.showErrorMessage('Rollback failed. Check Output panel for manual recovery instructions.');
    }
  }
}
```

## Alternatives Considered

### Alternative 1: No Backups (Rejected)
Just modify files directly, trust that it works.

**Problems**:
- No recovery from failures
- Damages user trust
- Support burden when things go wrong
- Professional tools don't work this way

### Alternative 2: Full Workspace Backup (Rejected)  
Back up entire VS Code workspace before making changes.

**Problems**:
- Massive disk usage
- Slow (hundreds of MBs)
- Unclear what changed (too much data)
- Overkill for modifying a few JSON files

### Alternative 3: Git Integration (Rejected)
Require workspace to be a Git repo, create commits before changes.

**Problems**:
- Not all users use Git
- Pollutes Git history
- Requires Git knowledge
- Doesn't work for global settings

## References
- src/util/fsSafe.ts
- src/core/orchestration/applier.ts
- src/core/orchestration/changeLog.ts
