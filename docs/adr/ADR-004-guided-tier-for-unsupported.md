# ADR-004: Guided Tier for Unsupported Assistants

## Status
Accepted

## Context
Not all AI coding assistants allow programmatic endpoint configuration. Some are closed-source (GitHub Copilot), some lack base_url settings (Tabnine), and some use proprietary protocols. Yet users with these tools still want to use the extension.

We must decide: Do we silently skip unsupported assistants, or provide value even when we can't auto-configure?

## Decision
We implemented a three-tier system (A/B/C) where Tier C assistants receive guided help instead of being ignored.

## Tier Definitions

### Tier A: Fully Auto-Configurable
Can detect AND auto-configure via settings/config files.

**Examples**: Continue, Cline, Roo Code, Kilo Code, Codex CLI

**Extension behavior**:
- Detect presence via extension API or CLI
- Build automated configuration plan (set-vscode-setting, edit-config-file)
- Apply changes automatically
- Verify configuration

### Tier B: Partially Configurable  
Can detect, but requires hybrid auto + manual steps.

**Examples**: CodeGPT (partial auto-config + manual UI settings)

**Extension behavior**:
- Detect presence  
- Apply automated steps where possible
- Provide guided manual steps for the rest
- Verify what we can

### Tier C: Guided Only
Can detect, but cannot auto-configure. Provide manual guidance.

**Examples**: GitHub Copilot, Tabnine, AnythingLLM Desktop

**Extension behavior**:
- Detect presence
- Explain why auto-config isn't possible
- Provide clear manual instructions
- Link to relevant documentation
- Suggest enterprise-approved alternatives if appropriate

## Rationale for Tier C

### Why Not Just Skip Them?

1. **User confusion**: "I have GitHub Copilot installed. Why doesn't the extension see it?" Detecting and explaining is better UX than silence.

2. **Enterprise guidance**: Even if we can't switch Copilot's endpoint, we can detect it and explain that GitHub Copilot doesn't support custom endpoints, then guide users to enterprise-approved alternatives that do.

3. **Future-proofing**: If Tier C tools add base_url support later, we're already detecting them. Upgrading from C to A/B is trivial.

4. **Completeness**: Extension can honestly say "We support all major assistants" because even Tier C gets value.

5. **Discovery**: Users might not know about Tier A alternatives. Detecting Copilot lets us say "Consider Continue or Cline which support custom endpoints."

### What Guided Help Looks Like

For GitHub Copilot (Tier C):

```
=== Manual Configuration Steps ===
Assistant: GitHub Copilot

GitHub Copilot does not support custom endpoint configuration in VS Code. 
It uses a proprietary connection to GitHub's hosted service.

Enterprise Options:
• GitHub Copilot Enterprise Server (for on-premise GitHub Enterprise)
• Consider Continue, Cline, or Roo Code - they support custom endpoints

For more information:
https://docs.github.com/en/copilot/overview-of-github-copilot/about-github-copilot-for-business
```

For Tabnine (Tier C):

```
=== Manual Configuration Steps ===
Assistant: Tabnine

Tabnine uses a proprietary protocol and endpoint configuration.

Enterprise Options:
• Tabnine Enterprise Server (contact Tabnine for self-hosted deployment)
• Configure via Tabnine Settings UI (not VS Code settings)

For custom LLM endpoints, consider:
• Continue, Cline, or Roo Code (fully support custom OpenAI-compatible endpoints)
```

## Implementation

### Registry Metadata

Each assistant in `assistants.registry.json` has:

```json
{
  "key": "github-copilot",
  "endpointSwitching": {
    "supported": false,
    "tier": "C",
    "configurationModes": ["guided-only"],
    "notes": [
      "Copilot does not expose a supported 'base_url' override in VS Code settings.",
      "Support means: detect presence, explain limitation, guide to alternatives."
    ]
  }
}
```

### Adapter Implementation

Tier C adapters return `show-guided-steps` actions:

```typescript
async buildPlan(profile: EndpointProfile): Promise<Plan> {
  return createPlan(profile.id, [this.key]).addStep({
    action: 'show-guided-steps',
    description: 'Manual guidance for GitHub Copilot',
    assistantKey: this.key,
    data: {
      steps: [
        'GitHub Copilot does not support custom endpoint configuration.',
        'It connects to GitHub\'s proprietary hosted service.',
        '',
        'Enterprise options:',
        '• GitHub Copilot Enterprise Server (for self-hosted GitHub)',
        '• Consider Continue, Cline, or Roo Code for custom endpoints'
      ]
    },
    reversible: false
  });
}
```

### Wizard UX

During setup, Tier C assistants are shown but marked as manual:

```
Detected Assistants:
☑ Continue (Auto)
☑ Cline (Auto)  
☐ GitHub Copilot (Manual guidance only)
```

If user selects a Tier C assistant, wizard shows guided steps in output panel after applying configuration.

## Consequences

### Positive
- Better UX than silence for unsupported tools
- Educational - users learn what's possible
- Enterprise guidance - steer users to supported alternatives
- Future-proof - easy to upgrade to A/B when tools add features
- Comprehensive - extension truly supports all major assistants

### Negative
- Cannot auto-configure everything (but we're honest about it)
- Guided steps might become outdated (mitigated by registry updates)
- Users might be disappointed we can't magic away limitations

## Alternatives Considered

### Alternative 1: Only Support Tier A (Rejected)
Ignore Tier B/C entirely.

**Problems**:
- Poor UX (users confused why their tool isn't detected)
- Missed opportunity for guidance
- Can't recommend alternatives
- Not future-proof

### Alternative 2: Try to Hack Tier C (Rejected)  
Attempt to modify internal configs or use unsupported APIs.

**Problems**:
- Brittle (breaks with every update)
- Violates tool's architecture
- Damages extension reputation
- Maintenance nightmare

### Alternative 3: Tier C = Warning Only (Considered)
Detect Tier C, show warning, do nothing else.

**Problems**:  
- Negative framing (warning feels bad)
- No actionable guidance
- Missed education opportunity

## References
- src/adapters/githubCopilot/adapter.ts
- src/adapters/tabnine/adapter.ts  
- src/adapters/anythingllm/adapter.ts
- src/core/registry/assistants.registry.json
- src/core/orchestration/planBuilder.ts (show-guided-steps action)
