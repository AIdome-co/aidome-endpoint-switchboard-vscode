# PR 61 Plan: Profile-Scoped Activation and Assignments

## Track 1 — Profile-Scoped Assistant Assignment
- Added focused coverage for assignment selection, profile resolution, no-op paths, confirmation cancellation, mixed success/failure summaries, detach failures, and extension-plus-CLI labeling.

## Track 2 — Activation and Reapply Flow
- Added coverage for profile activation command wiring, unmapped-profile assignment prompts, manage-profiles active-profile routing, and activation notice handling.

## Track 3 — Transactional Delete and Reassignment
- Added coverage for successful reassignment before deletion, rollback after partial reassignment failure, and early reassignment failure that keeps the source profile intact.

## Track 4 — Setup Wizard and Extension Lifecycle
- Added coverage for setup refresh-on-success and refresh-on-partial-success, extension activation state migration, first-run prompting, quick actions, and command argument validation.

## Track 5 — Mapping Persistence and Diagnostics
- Added coverage for profile-id-based mapping normalization, scoped mapping deletion, diagnostics profile/assistant rendering by profile ID, and multi-profile assistant reporting.

## Track 6 — Remaining Gaps
- Current unit coverage substantially improves the PR surface, but strict executable diff coverage is not yet 100% for every `main...HEAD` hunk because `src/commands/manageProfiles.ts` still has uncovered create/edit/delete/view branches and the working tree currently diverges from the committed PR in `src/commands/assignProfileAssistants.ts`.