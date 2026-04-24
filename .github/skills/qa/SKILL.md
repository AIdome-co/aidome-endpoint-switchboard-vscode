---
name: qa
description: Use when running an agentic QA pass on the AIdome Endpoint Switchboard extension — test planning, bug hunting, edge-case analysis, or pre-release verification. Wraps the gem-team-inspired QA agent pipeline (research → plan → generate → run → fix) plus adversarial review.
---

# Agentic QA Skill

A unified entry point for the QA pipeline. Use this skill when you need a
systematic quality pass rather than a single test tweak.

## When to invoke

- Adding or substantially changing an adapter, profile, or orchestration flow
- Before cutting a release (Phase 4 / 5 of the extension lifecycle)
- Investigating a flaky or regression-prone test
- Auditing agent files themselves for governance gaps
- Any time a reviewer asks "did we cover the edge cases?"

## Agent roster (see `.github/references/qa-workflow.md` for attribution)

| Agent | Role |
|---|---|
| `qa` | Adversarial QA specialist — test plan + bug hunt |
| `critic` | Challenges assumptions, finds logic gaps |
| `critical-thinking` | Pre-implementation questioning (no edits) |
| `test-researcher` | Analyze codebase for testability |
| `test-planner` | Phased test implementation plan |
| `test-generator` | RPI pipeline driver for generating tests |
| `test-fixer` | Fix compile / test failures |
| `test-runner` | Run tests, report results |
| `agent-governance-reviewer` | Reviews agent configs for governance gaps |
| `test-engineer` | Repo-native Vitest specialist (integration point) |

## Recommended pipeline

```
1. test-researcher   → inventory source files, existing tests, framework (Vitest)
2. test-planner      → phased plan covering adapters, profiles, orchestrators
3. critic            → critique plan: assumptions, edge cases, over-engineering
4. test-generator    → generate tests phase by phase (delegates to test-engineer
                       for repo-specific Vitest + vscode mock patterns)
5. test-runner       → npm test; report pass/fail
6. test-fixer        → fix compile / assertion errors; loop ≤ 3 times
7. qa                → exploratory / adversarial pass on merged result
8. agent-governance-reviewer → if any .agent.md file was touched
```

## Local invariants the QA pipeline must enforce

- `npm run lint` — zero errors; **no `console.log`** in `src/`
- `npm run compile` — zero TypeScript errors (strict mode)
- `npm test` — all unit tests + pre-release validation tests pass
- All credentials only in `vscode.SecretStorage`
- Every adapter `configure()` creates a timestamped backup before writing
- URL scheme allowlist enforced; profile names sanitized
- Redaction utility applied before any log of sensitive values

If the QA pipeline cannot satisfy any of the above, escalate to the
orchestrator; **do not weaken the tests or skip them**.

## Outputs

- Test plan in the PR description or a scratch file
- New/updated `test/**` files following `testing.instructions.md`
- Findings report with Severity (Critical / High / Medium / Low)
- Go/no-go recommendation for release (Phase 5 gate)

## See also

- `.github/references/qa-workflow.md` — gem-team alignment + attribution
- `.github/instructions/testing.instructions.md` — Vitest conventions
- `.github/agents/orchestrator.agent.md` — orchestration contract
