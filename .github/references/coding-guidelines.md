# Coding Guidelines

Deep reference for code quality standards in this extension.

## Priority Order

When making changes, apply this priority:

1. **Correctness** — Does it behave correctly in all cases, including error paths?
2. **Clarity** — Is it easy to understand without deep context?
3. **Optimization** — Only optimize when correctness and clarity are achieved and a
   real performance problem exists.

Do not sacrifice correctness or clarity for brevity or cleverness.

## Change Size

Keep PRs focused and small:

- Aim for ~200 lines of source code changed per PR, excluding generated files,
  documentation, and configuration files.
- One logical change per PR. Mix of unrelated fixes makes review harder.
- If a refactor is needed alongside a feature, do it in a separate PR.

## TypeScript Strict Mode

This project uses `"strict": true` in `tsconfig.json`. All rules are active:

- `strictNullChecks` — handle `null` and `undefined` explicitly
- `noImplicitAny` — all types must be declared or inferable
- `strictFunctionTypes` — function parameter types are checked contravariantly
- `strictPropertyInitialization` — class properties must be initialized

Do not add `// @ts-ignore` or `// @ts-expect-error` without a clear comment explaining
why it is necessary. Do not use `as any` as a shortcut to silence type errors.

## Design Patterns in Use

| Pattern | Where Used | Purpose |
|---|---|---|
| Adapter | Assistant integrations | Isolate each assistant's config format |
| Registry | Assistant discovery | Decouple detection from hard-coded lists |
| Strategy | Dialect selection | Swap config-writing strategies per assistant |
| Builder | Configuration plans | Construct plans incrementally before applying |

When adding new functionality, prefer extending an existing pattern over introducing a
new one. If a new pattern is needed, document it here.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Alternative |
|---|---|---|
| God objects | One class knows too much, hard to test | Split by responsibility |
| Tight coupling | One module directly creates or imports another's internals | Depend on interfaces |
| `any` types | Defeats type safety, hides bugs | Use `unknown` + type guards |
| Catch-all dirs | `utils/`, `helpers/` become dumping grounds | Name by role: `validators/`, `formatters/` |
| Silent error swallowing | `catch (e) {}` hides failures | Always log or surface errors |
| Console logging | Bypasses Logger, no redaction | Use the Logger class |
| Magic strings | Opaque values scattered in code | Use typed constants or enums |

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `profile-validator.ts` |
| Classes | PascalCase | `ProfileValidator` |
| Interfaces | PascalCase (no `I` prefix) | `AssistantAdapter` |
| Functions | camelCase, verb-noun | `validateProfileUrl()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_PROFILE_NAME_LENGTH` |
| Enum members | PascalCase | `AuthScheme.BearerToken` |
| Test files | `*.test.ts` | `profileValidator.test.ts` |

## Module Exports

- Export only what other modules need. Keep internals private.
- Avoid default exports — use named exports for better refactoring support.
- Group related exports in a module's index file when the module has multiple files.

## Comments

- Write comments to explain *why*, not *what*. The code explains what.
- Add JSDoc to all exported functions, classes, and interfaces.
- Remove commented-out code — use git history to recover old code.
- TODO comments must include a tracking reference or be fixed before release.
