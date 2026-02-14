# Revve Testing — Full Reference

## 1. Configuration

### vitest.config.mts

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist', 'tests/llm/**', 'tests/integration/**'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['libs/**', 'lib/**', 'action/**'],
      exclude: ['**/*.test.*', 'tests/**', '**/*.d.ts', '**/__tests__/**'],
      reporter: ['text', 'text-summary', 'json-summary', 'json'],
      reportOnFailure: true,
      thresholds: { lines: 10 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
      '@react-email/render': path.resolve(__dirname, 'tests/mocks/react-email-render.ts'),
    },
  },
});
```

Key points:
- `globals: true` — no need to import `describe`, `it`, `expect` (but you can for explicitness)
- `pool: 'forks'` — each test file runs in a separate process for isolation
- Unit tests auto-discovered via `**/*.test.ts`, integration/LLM tests excluded from default run
- Path alias `@/` resolves to project root, matching Next.js `tsconfig.json`
- `server-only` and `@react-email/render` are aliased to stub modules

---

## 2. Test Types

### Unit Tests
- **Location:** Co-located next to source file (e.g., `libs/stripe.test.ts` for `libs/stripe.ts`)
- **Purpose:** Test individual functions with all external deps mocked
- **Run with:** `pnpm test` or `pnpm test:unit`

### Integration Tests
- **Location:** `tests/integration/*.integration.test.ts`
- **Purpose:** Test real database operations, RLS policies, cross-table data flows
- **Prerequisites:** Local Supabase running (`supabase start`) + migrations applied (`pnpm migrate up`)
- **Run with:** `pnpm test:integration`

### LLM Evaluation Tests
- **Location:** `tests/llm/*.test.ts`
- **Purpose:** Evaluate LLM output quality across multiple models (OpenAI, Anthropic)
- **Prerequisites:** API keys in `.env.test` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- **Run with:** `pnpm test:llm`

---

## 3. Commands

```bash
# Unit tests
pnpm test                   # All unit tests
pnpm test:watch             # Watch mode
pnpm test:unit              # Excludes tests/** entirely
pnpm test:coverage          # With v8 coverage

# Integration tests (requires local Supabase)
pnpm test:integration

# LLM tests (requires API keys)
pnpm test:llm

# Run a single file
pnpm vitest run libs/stripe.test.ts
```

---

## 4. Unit Test Patterns

### 4.1 Basic Structure

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Declare mock fns
const mockFn = vi.fn();

// 2. Set up vi.mock() calls
vi.mock('@/libs/supabase', () => ({
  supabaseServiceRoleClient: { from: vi.fn() },
}));

// 3. Import the module under test AFTER vi.mock()
import { myFunction } from '@/libs/myModule';

describe('myFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', async () => {
    mockFn.mockResolvedValue({ data: 'test' });
    const result = await myFunction();
    expect(result).toBe('test');
  });
});
```

### 4.2 Supabase Client Mocking

The most common pattern — mock the chainable query builder:

```ts
const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({ data: null, error: null }),
});
const mockInsert = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'new-1' }, error: null }),
  }),
});

vi.mock('@/libs/supabase', () => ({
  supabaseServiceRoleClient: {
    from: vi.fn().mockImplementation(() => ({
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert,
    })),
  },
}));
```

For multi-table mocking, use a routing `from()`:

```ts
const { mockInsert, mockFrom } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockReturnValue({ error: null });
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'chat_messages') return { insert: mockInsert };
    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn() }),
        }),
      };
    }
    return {};
  });
  return { mockInsert, mockFrom };
});

vi.mock('@/libs/supabase', () => ({
  supabaseServiceRoleClient: { from: mockFrom },
}));
```

### 4.3 External Service Constructor Mocks (Stripe, Resend, BullMQ)

**CRITICAL: Must use `function()`, not arrow functions.** Vitest 4.x throws when calling `new` on arrow function mocks.

#### Stripe

```ts
const mockSessionsCreate = vi.fn();

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        checkout: { sessions: { create: mockSessionsCreate } },
        webhooks: { constructEvent: vi.fn() },
      };
    }),
  };
});
```

#### Resend

```ts
const resendSendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: resendSendMock } };
  }),
}));
```

#### BullMQ Queue

```ts
const queueAddMock = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: queueAddMock };
  }),
}));
```

### 4.4 `vi.hoisted()` for Variables Used in `vi.mock()` Factories

When mock variables need to be referenced inside `vi.mock()` factory functions, use `vi.hoisted()` to ensure they are declared before hoisting occurs:

```ts
const {
  mockFrom,
  mockConstructEvent,
  mockHeadersGet,
} = vi.hoisted(() => {
  const mockFrom = vi.fn().mockReturnValue({ update: vi.fn() });
  const mockConstructEvent = vi.fn();
  const mockHeadersGet = vi.fn();
  return { mockFrom, mockConstructEvent, mockHeadersGet };
});

vi.mock('@/libs/supabase', () => ({
  supabaseServiceRoleClient: { from: mockFrom },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: mockHeadersGet }),
}));
```

### 4.5 next/headers Mocking

```ts
const mockHeadersGet = vi.fn();

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: mockHeadersGet }),
}));

// In beforeEach:
mockHeadersGet.mockReturnValue('some-header-value');
```

### 4.6 Testing with `vi.resetModules()` (Environment-Dependent Code)

When the module under test reads `process.env` at import time, use dynamic imports with `vi.resetModules()`:

```ts
beforeEach(() => {
  vi.resetModules();
  delete process.env.EMAIL_TRANSPORT;
});

it('uses Resend by default', async () => {
  process.env.RESEND_API_KEY = 'resend-api-key';
  const { sendEmail } = await import('@/libs/email/transport');
  await sendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'Test', html: '<p>Hi</p>' });
  expect(resendSendMock).toHaveBeenCalled();
});
```

### 4.7 Pure Function Tests (No Mocking)

For pure functions, no mocking needed — just import and test:

```ts
import { sanitizeContactPayload } from '@/libs/contact';

describe('sanitizeContactPayload', () => {
  it('should lowercase valid email', () => {
    const result = sanitizeContactPayload({ name: 'Test', email: 'JOHN@EXAMPLE.COM' });
    expect(result.email).toBe('john@example.com');
  });

  it('should reject invalid email format', () => {
    expect(() => sanitizeContactPayload({ name: 'Test', email: 'not-an-email', phoneNumber: '+1' }))
      .toThrow('email is invalid');
  });
});
```

---

## 5. Integration Test Patterns

### 5.1 Setup Utilities (`tests/integration/setup.ts`)

Provides factory functions for test data:

| Function                  | Purpose                                             |
|---------------------------|-----------------------------------------------------|
| `createTestClient()`     | Service-role Supabase client (bypasses RLS)         |
| `createTestIds()`        | Generate UUIDs for test data                        |
| `createTestAuthUser()`   | Create a real auth user via Admin API               |
| `createUserClient()`     | Supabase client authenticated as a user (respects RLS) |
| `createAnonClient()`     | Unauthenticated client (for RLS testing)            |
| `createTestTeam()`       | Insert a team record                                |
| `addUserToTeam()`        | Insert a team_users record                          |
| `createTestChatBot()`    | Insert a chat_bot record                            |
| `createTestCallBot()`    | Insert a call_bot record                            |
| `createLockFields()`     | Generate lock metadata for draft records            |
| `waitForDatabase()`      | Retry until DB is responsive (useful in CI)         |

### 5.2 Integration Test Structure

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestClient, createTestIds, createTestTeam,
  addUserToTeam, createTestAuthUser, createUserClient,
  createAnonClient, TestIds, clearUserClientCache,
} from './setup';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types';

describe('Feature Integration Tests', () => {
  let serviceClient: SupabaseClient<Database>;
  let ids: TestIds;

  beforeAll(async () => {
    serviceClient = createTestClient();
    ids = createTestIds();

    // Create auth user
    const { userId, email } = await createTestAuthUser(serviceClient, ids.testId);
    ids.userId = userId;
    ids.userEmail = email;

    // Create team + membership
    await createTestTeam(serviceClient, ids);
    await addUserToTeam(serviceClient, ids.teamId, ids.userId, 'owner');
  });

  afterAll(async () => {
    clearUserClientCache();
    // Clean up in reverse dependency order
    await serviceClient.from('team_users').delete().eq('team_id', ids.teamId);
    await serviceClient.from('teams').delete().eq('id', ids.teamId);
    if (ids.userId) await serviceClient.auth.admin.deleteUser(ids.userId);
  });

  it('should allow team member to read team data', async () => {
    const userClient = await createUserClient(ids.userEmail);
    const { data, error } = await userClient
      .from('teams')
      .select('id, name')
      .eq('id', ids.teamId)
      .single();

    expect(error).toBeNull();
    expect(data?.name).toContain('Test Team');
  });

  it('should NOT allow anon user to read team data', async () => {
    const anonClient = createAnonClient();
    const { data } = await anonClient
      .from('teams')
      .select('id')
      .eq('id', ids.teamId);

    expect(data).toEqual([]);
  });
});
```

### 5.3 RLS Testing Pattern

Use three client types to verify row-level security:

1. **Service client** (`createTestClient()`) — bypasses RLS, used for setup/teardown
2. **User client** (`createUserClient(email)`) — authenticated, respects RLS
3. **Anon client** (`createAnonClient()`) — unauthenticated, respects RLS

```ts
// Service role can read everything
const { data: adminData } = await serviceClient.from('team_invitations').select('*');
expect(adminData?.length).toBeGreaterThan(0);

// Authenticated user can only see their team's data
const userClient = await createUserClient(ids.userEmail);
const { data: userData } = await userClient.from('team_invitations').select('*').eq('team_id', ids.teamId);
expect(userData?.length).toBeGreaterThan(0);

// Other user cannot see data
const otherClient = await createUserClient(otherUserEmail);
const { data: otherData } = await otherClient.from('team_invitations').select('*').eq('id', ids.invitationId).single();
expect(otherData).toBeNull();

// Anon user gets empty results
const anonClient = createAnonClient();
const { data: anonData } = await anonClient.from('team_invitations').select('*').limit(10);
expect(anonData).toEqual([]);
```

### 5.4 Cleanup Order

Always delete in reverse dependency order to avoid foreign key violations:

```ts
afterAll(async () => {
  clearUserClientCache();
  // Children first
  await serviceClient.from('chat_bot_drafts').delete().eq('chat_bot_id', ids.chatBotId);
  await serviceClient.from('chat_bots').delete().eq('id', ids.chatBotId);
  await serviceClient.from('team_users').delete().eq('team_id', ids.teamId);
  await serviceClient.from('teams').delete().eq('id', ids.teamId);
  // Auth users last
  if (ids.userId) await serviceClient.auth.admin.deleteUser(ids.userId);
});
```

---

## 6. LLM Test Patterns

### 6.1 Multi-Model Configuration

```ts
import { LLMConfig } from '@/tests/llm/helper';

const llmConfigs: LLMConfig[] = [
  { provider: 'openai', model: 'o4-mini' },
  { provider: 'claude', model: 'claude-4-sonnet-20250514' },
];
```

### 6.2 Test Case Structure

Test cases are defined in separate `*-cases.ts` files:

```
tests/llm/
  decision-cases.ts          # Test case definitions
  decision.test.ts           # Test runner
  thread-analyze-cases.ts
  thread-analyze.test.ts
  helper.ts                  # Shared types and utilities
```

### 6.3 Assertion Tracking

LLM tests track per-field assertion results for detailed reporting:

```ts
interface FieldResult {
  field: string;
  passed: boolean;
  expected: any;
  actual: any;
  message: string;
}

// Collect results per test case per model
const allTestResults: TestResult[] = [];
```

### 6.4 Result Storage

Results are written to three formats in `afterAll`:
1. **Detailed JSON** — full assertion data per test case
2. **Summary JSON** — aggregated pass rates by model
3. **Markdown report** — human-readable with failure details

If Supabase credentials are available (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), results are also saved to:
- `test.llm_test_results` table (summary)
- `test.llm_test_case_results` table (individual cases)
- `test-results` storage bucket (JSON + markdown files)

### 6.5 Timeout

LLM tests use extended timeouts:

```ts
it('should correctly analyze', async () => {
  // ...
}, 180000); // 3 minutes per test case
```

---

## 7. Shared Mocks

### `tests/mocks/server-only.ts`

Stubs the `server-only` package that Next.js uses to prevent client imports:

```ts
export {};
```

Aliased in `vitest.config.mts` so any `import 'server-only'` resolves to this empty module.

### `tests/mocks/react-email-render.ts`

Provides a configurable mock for `@react-email/render`:

```ts
declare global {
  var __emailRenderMock: ((...args: any[]) => any) | undefined;
}

export const render = (...args: any[]) => {
  if (!globalThis.__emailRenderMock) {
    throw new Error('Email render mock not configured.');
  }
  return globalThis.__emailRenderMock(...args);
};
```

Usage in tests:

```ts
const renderMock = vi.fn();
globalThis.__emailRenderMock = (...args: any[]) => renderMock(...args);

// In beforeEach:
renderMock.mockReset();
globalThis.__emailRenderMock = (...args) => renderMock(...args);
```

---

## 8. CI/CD Workflows

### 8.1 Build Check (`.github/workflows/build-check.yml`)

Triggers on: push to any branch except `main`, PRs to `main`.

Three parallel jobs:

| Job               | What it does                                          |
|-------------------|-------------------------------------------------------|
| `unit-test`       | Runs `pnpm vitest --coverage.enabled true`, posts coverage comment on PR |
| `integration-test`| Calls reusable `integration-tests.yml` workflow       |
| `build`           | Runs `pnpm run build` with placeholder env vars       |

Coverage PR comments use [`davelosert/vitest-coverage-report-action@v2`](https://github.com/davelosert/vitest-coverage-report-action).

### 8.2 Integration Tests (`.github/workflows/integration-tests.yml`)

Reusable workflow (`workflow_call`). Steps:
1. Start local Supabase (excluding studio/imgproxy/edge-runtime/logflare/vector)
2. Install dependencies in parallel with Supabase startup
3. Extract Supabase credentials from `supabase status --output json`
4. Run database migrations (`pnpm migrate up`)
5. Execute `pnpm test:integration`
6. Stop Supabase (`supabase stop --no-backup`)

### 8.3 LLM Tests (`.github/workflows/run-llm-tests.yml`)

Triggers on: `workflow_dispatch` (manual only). Steps:
1. Create `.env.test` from GitHub secrets
2. Run `pnpm test:llm`
3. Parse `test-results/` directory for summary JSON files
4. Upload results as GitHub artifacts
5. Send Slack notification with per-model pass rates

---

## 9. Common Pitfalls

### 9.1 Arrow Functions in Constructor Mocks

**Wrong** — Vitest 4.x throws `TypeError: Class constructor X cannot be invoked without 'new'`:

```ts
// BAD
vi.mock('stripe', () => ({
  default: vi.fn(() => ({ checkout: { sessions: { create: vi.fn() } } })),
}));
```

**Correct:**

```ts
// GOOD
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(function () {
    return { checkout: { sessions: { create: vi.fn() } } };
  }),
}));
```

### 9.2 Hoisting — Variables Not Available in `vi.mock()` Factory

**Wrong** — `mockFn` is `undefined` inside the factory because `vi.mock()` is hoisted above variable declarations:

```ts
// BAD
const mockFn = vi.fn();
vi.mock('@/libs/foo', () => ({
  bar: mockFn, // undefined at hoist time!
}));
```

**Correct** — use `vi.hoisted()`:

```ts
// GOOD
const { mockFn } = vi.hoisted(() => {
  const mockFn = vi.fn();
  return { mockFn };
});

vi.mock('@/libs/foo', () => ({
  bar: mockFn,
}));
```

**Alternative** — declare mock fns at module top-level (works when not using `vi.hoisted`):

```ts
// ALSO GOOD — top-level const declarations are available to hoisted vi.mock()
// ONLY when the variable is declared with const/let at the module scope
const mockFn = vi.fn();

vi.mock('@/libs/foo', () => ({
  bar: mockFn,
}));
```

The key rule: if the variable is assigned by a call to `vi.fn()` at the top of the file, it is available. If it depends on other runtime values, use `vi.hoisted()`.

### 9.3 Import Order

Always import the module under test **after** all `vi.mock()` calls:

```ts
// 1. Imports from vitest
import { describe, it, expect, vi } from 'vitest';

// 2. Mock declarations
const mockFn = vi.fn();
vi.mock('@/libs/dep', () => ({ dep: mockFn }));

// 3. Import under test (MUST come after vi.mock)
import { myFunction } from '@/libs/myModule';
```

### 9.4 Forgetting `vi.clearAllMocks()` in `beforeEach`

Always reset mocks between tests to avoid cross-test pollution:

```ts
beforeEach(() => {
  vi.clearAllMocks();
});
```

### 9.5 Integration Test Environment Variables

Integration tests require these env vars (set automatically in CI):
- `NEXT_PUBLIC_SUPABASE_URL` or `SERVICE_ROLE_LOCAL_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (for migrations)

Locally, these come from your `.env` / `.env.local` files.

### 9.6 Test Results Directory

LLM tests write to `test-results/` which is gitignored. The directory is created automatically by the test runner.
