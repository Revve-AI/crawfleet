# Revve Testing — Quick Reference

## When to Apply

Load this skill when:
- Writing or modifying any test file (`*.test.ts`, `*.test.tsx`)
- Adding mocks for Supabase, Stripe, BullMQ, Resend, or next/headers
- Working with integration tests (`tests/integration/`)
- Working with LLM evaluation tests (`tests/llm/`)
- Debugging CI test failures in `build-check.yml`, `integration-tests.yml`, or `run-llm-tests.yml`

## Decision Table: Which Test Type?

| Scenario                              | Type          | Location                     | Command               |
|---------------------------------------|---------------|------------------------------|-----------------------|
| Pure function / utility logic         | Unit          | Co-located `*.test.ts`       | `pnpm test`           |
| Server action with mocked deps       | Unit          | Co-located `*.test.ts`       | `pnpm test`           |
| API route handler with mocked deps   | Unit          | Co-located `*.test.ts`       | `pnpm test`           |
| RLS policy / real DB operations       | Integration   | `tests/integration/`         | `pnpm test:integration` |
| Cross-table data flow                | Integration   | `tests/integration/`         | `pnpm test:integration` |
| LLM output quality / multi-model     | LLM           | `tests/llm/`                 | `pnpm test:llm`       |

## Commands Cheat Sheet

```bash
pnpm test                # Run all unit tests (excludes tests/llm/ and tests/integration/)
pnpm test:watch          # Watch mode for unit tests
pnpm test:unit           # Unit tests only (excludes tests/**)
pnpm test:integration    # Integration tests (requires local Supabase)
pnpm test:llm            # LLM evaluation tests (requires API keys)
pnpm test:coverage       # Unit tests with v8 coverage report
```

## Config Summary

| Setting            | Value                                               |
|--------------------|-----------------------------------------------------|
| Framework          | Vitest 4.x                                          |
| Environment        | jsdom                                               |
| Pool               | forks                                               |
| Globals            | `true` (describe/it/expect available without import) |
| Coverage provider  | v8                                                  |
| Coverage targets   | `libs/**`, `lib/**`, `action/**`                    |
| Coverage threshold | 10% lines                                           |
| Path alias `@/`    | Project root                                        |

### Shared Module Aliases (vitest.config.mts)

```
'server-only'         -> tests/mocks/server-only.ts   (empty export)
'@react-email/render' -> tests/mocks/react-email-render.ts (configurable via globalThis.__emailRenderMock)
```

## Key Rules

1. **Constructor mocks must use `function()`** — never arrow functions. Vitest 4.x requires `function()` for `new`-able mocks (Stripe, Resend, BullMQ Queue).
2. **Use `vi.hoisted()`** when mock variables are referenced inside `vi.mock()` factory functions.
3. **Import after `vi.mock()`** — module imports must come after all `vi.mock()` calls.
4. **Integration tests need local Supabase** — `supabase start` + `pnpm migrate up` before running.
5. **LLM tests need API keys** — set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env.test`.
6. **Clean up test data** — integration tests must delete created records in `afterAll` (reverse dependency order).
7. **Unit test files are co-located** — place `foo.test.ts` next to `foo.ts` in the same directory.

## Full Reference

See `AGENTS.md` in this skill directory for complete code examples and patterns.
