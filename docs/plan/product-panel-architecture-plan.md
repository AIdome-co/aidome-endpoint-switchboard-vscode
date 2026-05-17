# Product Panel Architecture Plan

## Purpose

This document captures the target panel architecture for the AIdome Endpoint Switchboard product UI.

The immediate trigger for this plan was the new guided setup panel. That panel is useful, but it should not remain a one-off Claude Code surface. The product should evolve toward a coherent, settings-style shell that represents the full Switchboard experience:

- profiles
- assistants
- guided manual follow-up
- verification
- models and providers
- diagnostics
- history and reset
- advanced settings

The goal is to replace the current output-channel-centric experience with a first-class product surface that feels closer to a mature settings application.

## Current Context

### Why Claude Code appears first today

Claude Code is currently the default preview assistant when the guided setup panel opens without saved state. That is a temporary bootstrap choice for the panel preview, not a product decision that the UI is Claude-specific.

In the long term, the guided setup surface should open to a multi-assistant hub or to the most recently active assistant that needs manual follow-up.

### Product command surface today

The extension already exposes a broader product than the current panel suggests:

| Area | Current command |
|---|---|
| Setup | `aidome-switchboard.setupSwitchboard` |
| Verification | `aidome-switchboard.verifyRouting` |
| Models | `aidome-switchboard.showModelsProviders` |
| Profiles | `aidome-switchboard.manageProfiles` |
| Reset | `aidome-switchboard.resetSwitchboard` |
| Diagnostics | `aidome-switchboard.exportDiagnostics` |
| Guided UI | `aidome-switchboard.openGuidedSetup` |

### Supported assistants relevant to panel design

The product is not just about Claude Code. The supported assistant surface currently includes:

| Assistant | Current role in product |
|---|---|
| Continue | Automated assistant configuration |
| Roo Code | Automated assistant configuration |
| OpenAI Codex | Automated assistant configuration |
| GitHub Copilot | Partial configuration / settings-based flow |
| Claude Code | Guided + automated config file flow |
| Kilo Code | Automated or guided settings flow |
| Cline | Automated or guided settings flow |
| CodeGPT | Automated or guided settings flow |
| AnythingLLM | Guided desktop-app configuration |
| Tabnine | Informational / limitation guidance |
| Gemini CLI | Informational / limitation guidance |

The assistants that naturally belong in the guided setup experience today are:

- Claude Code
- Kilo Code
- Cline
- CodeGPT
- AnythingLLM
- Tabnine
- Gemini CLI

## Product UI Direction

### Design goal

The product should feel like a settings-oriented control center rather than a sequence of disconnected commands, modal prompts, and output logs.

That means:

- first-class navigation
- persistent state
- per-assistant status visibility
- clear progress and pending actions
- actionable follow-up surfaces
- logs as a secondary debugging surface, not the primary UI

### Experience principles

| Principle | Meaning |
|---|---|
| Product shell first | Users should enter a coherent Switchboard workspace, not isolated command results. |
| Assistant-aware UX | Each assistant should have status, configuration mode, and next actions. |
| Profiles as first-class objects | Endpoint profiles should anchor the rest of the experience. |
| Guided setup as a workspace | Manual follow-up should live in a panel designed for actions, not logs. |
| Verification as a product area | Verification should be inspectable, rerunnable, and historical. |
| Logs are secondary | Output channel remains valuable for diagnostics, but not as the primary UI. |

## Full Product Panel Representation

## 1. Product Shell

This should become the top-level UI container for the whole extension.

### Left navigation

- Overview
- Profiles
- Assistants
- Guided Setup
- Verification
- Models & Providers
- Diagnostics
- History & Reset
- Advanced

### Global top bar

- active profile selector
- current endpoint badge
- global verification status
- quick actions

Suggested quick actions:

- Setup
- Verify
- Open Guided Setup
- Export Diagnostics

## 2. Overview Panel

This should be the landing page for the product.

### Purpose

Provide one-screen awareness of the current state of Switchboard.

### Contents

- active profile summary
- connected assistants summary
- assistants needing manual follow-up
- latest verification result
- recent changes
- quick actions

### Questions this page answers

- Which profile is active?
- Which assistants are currently configured?
- Which assistants still need work?
- Is the current routing healthy?

## 3. Profiles Panel

This should elevate endpoint profiles into a persistent product surface.

### Layout

- left list of profiles
- main detail pane for selected profile

### Profile detail sections

- Base URL
- Dialect
- Auth status
- Last verification result
- Assigned assistants
- Available actions

### Actions

- Verify
- Duplicate
- Set Active
- Delete

This page should eventually replace much of the modal-heavy profile management flow.

## 4. Assistants Panel

This should represent the assistant fleet as a whole.

### Layout

An assistant index page with cards or rows.

### Each assistant item should show

- detection status
- support tier / automation level
- current profile binding
- configuration mode: Auto / Guided / Info Only
- current status

### Suggested statuses

- Configured
- Needs manual action
- Verification failed
- Unsupported
- Not detected

### Natural assistants to show here

- Continue
- Roo Code
- OpenAI Codex
- GitHub Copilot
- Claude Code
- Kilo Code
- Cline
- CodeGPT
- AnythingLLM
- Tabnine
- Gemini CLI

Clicking an assistant should open Assistant Detail.

## 5. Assistant Detail Panel

This is where the current guided setup panel concept belongs, but generalized.

### Purpose

Provide one workspace for a single assistant.

### Shared sections

- detection state
- support tier
- configuration mode
- currently applied profile
- manual follow-up items
- verification status
- assistant-specific actions

### Claude Code detail example

- shared settings file path
- gateway base URL status
- credential guidance
- supported gateway format constraints
- action buttons: open config, copy endpoint, verify, rerun setup

### Kilo / Cline / CodeGPT detail example

- discovered setting keys
- whether automation succeeded
- manual fallback steps if not

### Tabnine / Gemini detail example

- why endpoint switching is limited or unsupported
- recommended alternatives
- product limitation explanation

## 6. Guided Setup Panel

This should become a full workspace, not just “open the last assistant.”

### Purpose

Centralize all manual follow-up tasks across assistants.

### Layout

- left rail of assistants requiring follow-up
- main pane with assistant-specific setup steps

### Example entries

- Claude Code
- Kilo Code
- AnythingLLM
- Tabnine

### Main pane contents

- assistant-specific guided steps
- copy actions
- open-file actions
- verification action
- completion checklist
- follow-up state

### Important note

This is the natural home for the richer settings-style surface the product needs.

The current guided panel should evolve into this page.

## 7. Verification Panel

Verification should be treated as a major product area, not just a command output.

### Suggested tabs

- Current Profile
- All Profiles
- Assistant Compatibility

### Core content

- current verification report
- historical runs
- changes since last run
- suggested fixes
- optional raw details section

### Distinctions that should be visible

- endpoint verification
- assistant compatibility verification
- runtime verification

## 8. Models & Providers Panel

This should expose what the gateway actually offers.

### Contents

- available models
- providers
- capability flags
- dialect compatibility notes
- assistant compatibility notes

### Questions this page answers

- Which models are exposed?
- Which providers are available?
- Which assistants can consume which models cleanly?

## 9. Diagnostics Panel

This should be the structured support surface.

### Contents

- logs
- extension state
- installed assistants
- active profile
- environment and TLS notes
- export bundle actions

The existing diagnostics webview fits naturally here.

## 10. History & Reset Panel

This should make the system safer and more understandable.

### Contents

- change history
- rollbackable changes
- per-assistant reset actions
- full reset action
- backups and restore points

This page should answer:

- What changed?
- What can be undone?
- How do I recover a broken configuration?

## 11. Advanced Panel

This should surface runtime and verifier tuning.

### Contents

- timeout controls
- TLS verification behavior
- retry behavior
- cache TTL
- logging behavior
- remote environment notes

This is the natural UI counterpart to the current `aidome-switchboard.advanced.*` settings.

## Information Architecture Summary

```text
AIdome Switchboard
├─ Overview
├─ Profiles
│  ├─ Profile List
│  └─ Profile Detail
├─ Assistants
│  ├─ All Assistants
│  └─ Assistant Detail
├─ Guided Setup
│  ├─ Pending Manual Actions
│  └─ Assistant Setup Workspace
├─ Verification
│  ├─ Current Profile
│  ├─ All Profiles
│  └─ Assistant Compatibility
├─ Models & Providers
├─ Diagnostics
├─ History & Reset
└─ Advanced
```

## Where the current panel fits

The panel implemented so far should be considered an early version of:

- Guided Setup → Assistant Setup Workspace

It should not remain:

- Claude-only
- output-channel-adjacent
- the sole UI representation of the product

## Recommended Evolution Path

### Phase 1

Turn the current panel into a proper Guided Setup hub.

#### Goal

Stop treating guided setup as “the last assistant panel.”

#### Work

- open into a multi-assistant hub first
- list assistants that need follow-up
- persist per-assistant setup state
- support assistant-to-assistant navigation inside the panel

### Phase 2

Add an Assistants index page.

#### Goal

Represent the full assistant ecosystem visually.

#### Work

- assistant cards or rows
- detection status
- tier / automation mode
- current state and next action

### Phase 3

Add an Overview dashboard.

#### Goal

Give the product a real landing surface.

#### Work

- active profile
- routing health
- pending tasks
- assistant summary
- quick actions

### Phase 4

Bring Profiles and Verification into the same shell.

#### Goal

Move core workflows out of disconnected commands and into the product UI.

#### Work

- profile list/detail pages
- verification pages with history
- assistant compatibility subviews

### Phase 5

Unify Diagnostics, Reset, and Advanced pages.

#### Goal

Complete the control-center model.

#### Work

- diagnostics panel
- change history and reset panel
- advanced settings UI

## UX Implications

### What should change from current behavior

| Current state | Target state |
|---|---|
| Guided steps are written to output logs and optionally mirrored in a panel. | Guided setup becomes a persistent workspace. |
| Claude appears first because of a preview default. | The product opens to a multi-assistant or product-level context. |
| Commands feel separate. | The product feels like one coherent application shell. |
| Verification is mostly a report. | Verification becomes a navigable product area with history and fixes. |
| Profiles and assistants are mostly command-driven. | Profiles and assistants become primary visible entities in the UI. |

## Product Decision Summary

The panel work should be treated as the beginning of a broader UI architecture, not as a final “Claude panel.”

### Product decisions

- The current guided panel is an example of the pattern, not the whole product.
- Claude Code is a preview/default entry point right now, not the defining scope.
- The product should evolve into a settings-style shell that represents all supported assistants and all major Switchboard workflows.
- The correct next build step is a Guided Setup hub, followed by an Assistants index, followed by an Overview dashboard.

## Suggested next implementation order

1. Build a true Guided Setup hub page with assistant navigation.
2. Add an Assistants index page.
3. Add an Overview dashboard.
4. Fold Profiles and Verification into the same shell.
5. Finish the product with Diagnostics, History & Reset, and Advanced pages.