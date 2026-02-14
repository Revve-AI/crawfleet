# Revve Core Implementation Guide — Full Reference

> Project-specific patterns and conventions for the Revve AI codebase.
> For generic React/Next.js performance optimization, see `react-best-practices`.

---

## 1. Design System

**CRITICAL: Never use hardcoded colors. Always use CSS variable tokens.**

### 1.1 Color Tokens

| Need             | Use This                | NOT This            |
|------------------|-------------------------|---------------------|
| Primary color    | `bg-primary`            | `bg-[#E65c1a]`      |
| Primary text     | `text-primary`          | `text-orange-600`   |
| Primary ring     | `ring-primary`          | `ring-[#E65c1a]`    |
| Primary border   | `border-primary`        | `border-orange-500` |
| Muted background | `bg-muted`              | `bg-gray-100`       |
| Muted text       | `text-muted-foreground` | `text-gray-500`     |
| Destructive      | `bg-destructive`        | `bg-red-500`        |

### 1.2 CSS Variables (from globals.css)

- `--primary`: 18 80% 50.6% (Orange #E65C1A in light mode)
- `--secondary`: 220 14.3% 95.9%
- `--muted`: 220 14.3% 95.9%
- `--destructive`: 0 84.2% 60.2%
- `--accent`: 220 14.3% 95.9%
- `--ring`: Same as primary

### 1.3 Dark Mode

Colors automatically switch via CSS variables:

- Light primary: Orange (#E65C1A)
- Dark primary: Purple (hsl 263.4 70% 50.4%)

### 1.4 Component Patterns

- Cards: Always use `shadow-none` class
- Base components: Check `components/ui/` before creating new
- Forms: Use react-hook-form with zodResolver
- Chart colors: Import from `/lib/constants/chart.ts`

```typescript
import {CHART_COLORS} from "@/lib/constants/chart"
```

### 1.5 Known Violations to Fix

- `components/UserSignUpForm.tsx` — `#E65c1a`, `orange-600`
- `components/channels/SMSPreviewChat.tsx` — `bg-[#e86a38]`
- `components/shad/NavBar.tsx` — `text-[#E65c1a]`

---

## 2. Frontend Components

### 2.1 Pre-Implementation

1. Check if similar component exists in `components/ui/`
2. Reference `app/globals.css` for CSS variables
3. URL State Management: All filter states, pagination, and detail views should be reflected in the URL

### 2.2 Component Structure

```typescript
// 1. Imports (React, UI components, hooks, utils)
// 2. Types/Interfaces
// 3. Component function
//    - Hooks first (useState, useEffect, custom hooks)
//    - Event handlers
//    - Effects
//    - JSX return
```

### 2.3 State Management Patterns

- **Local state**: `useState`, `useReducer`
- **URL state**: `useSearchParams` for filters/pagination (all filters should reflect in URL)
- **Server state**: React Query (`@tanstack/react-query`)
- **Form state**: React Hook Form with zodResolver

### 2.4 Import Conventions

```typescript
// UI components
import {Button} from "@/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card"
import {Input} from "@/components/ui/input"

// Utilities
import {cn} from "@/lib/utils"

// Types
import type {ChatBot} from "@/types"
```

### 2.5 Form Handling Pattern

```typescript
import {useForm} from "react-hook-form"
import {zodResolver} from "@hookform/resolvers/zod"
import {z} from "zod"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
})

const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: {name: "", email: ""}
})
```

### 2.6 Accessibility Requirements

- All interactive elements need proper ARIA labels
- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`)
- Ensure keyboard navigation works
- Color contrast must meet WCAG standards

### 2.7 Performance Considerations

- Use `useMemo` for expensive computations
- Use `useCallback` for event handlers passed to children
- Lazy load heavy components with `dynamic()` from Next.js

---

## 3. Data Fetching

### 3.1 Decision Matrix

| Scenario                   | Use This        | Location            |
|----------------------------|-----------------|---------------------|
| Simple read with RLS       | Client Supabase | Component           |
| Real-time subscription     | Client Supabase | Component           |
| Multi-step workflow        | Server Action   | `action/*.ts`       |
| Mutation with side effects | Server Action   | `action/*.ts`       |
| External webhook handler   | API Route       | `app/api/webhook/*` |
| API key authentication     | API Route       | `app/api/*`         |
| Public endpoint (widget)   | API Route       | `app/api/*`         |

### 3.2 Pattern 1: Client Supabase (Simple Reads)

```typescript
// In 'use client' component
import {createClientComponentClient} from "@supabase/auth-helpers-nextjs"

const supabase = createClientComponentClient()
const {data} = await supabase
  .from('chat_threads')
  .select('*')
  .eq('team_id', teamId)
```

**When to use:** User-specific data with RLS, no side effects, real-time subscriptions, simple CRUD without business
logic.

### 3.3 Pattern 2: Server Action (Complex Logic)

```typescript
// action/chatbot.ts
"use server"
import {createServerActionClient} from "@supabase/auth-helpers-nextjs"
import {cookies} from "next/headers"

export async function updateChatBot(id: string, data: Partial<ChatBot>) {
  const supabase = createServerActionClient({cookies})
  const {data: {session}} = await supabase.auth.getSession()

  if (!session) return {success: false, error: "UNAUTHORIZED"}

  const result = await supabase.from('chat_bots').update(data).eq('id', id)

  revalidatePath('/dashboard/[teamSlug]/chatbots')
  return {success: true, data: result.data}
}
```

**When to use:** Multi-step workflows, mutations with side effects, session validation, revalidation after mutation,
complex business logic.

### 3.4 Pattern 3: API Route (External Integration)

```typescript
// app/api/webhook/hubspot/route.ts
import {NextRequest, NextResponse} from "next/server"
import {supabaseServiceRoleClient} from "@/libs/supabase"

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-hubspot-signature')
  if (!isValidSignature(signature)) {
    return NextResponse.json({error: 'Invalid signature'}, {status: 401})
  }

  const payload = await request.json()
  await supabaseServiceRoleClient.from('events').insert(payload)

  return NextResponse.json({success: true})
}
```

**When to use:** Webhooks from external services, API key auth, public endpoints, cross-origin requests.

### 3.5 Anti-Patterns

- Using API routes for authenticated user operations → Use Server Actions
- Using Server Actions for webhook handlers → Use API Routes
- Complex business logic in client components → Move to Server Actions
- Direct database mutations in components → Use Server Actions

---

## 4. API Endpoints

### 4.1 Pre-Implementation

1. Check if similar endpoint exists in `app/api/`
2. Determine auth pattern needed (see Section 3)
3. For cron jobs: create at `app/api/crons/` then register in `vercel.json`

### 4.2 Authentication: User Session (Dashboard APIs)

```typescript
import {createRouteHandlerClient} from "@supabase/auth-helpers-nextjs"
import {cookies} from "next/headers"

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({cookies})
  const {data: {session}} = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401})
  }
}
```

### 4.3 Authentication: Service Role (Internal/Crons)

```typescript
import {supabaseServiceRoleClient} from "@/libs/supabase"

export async function POST(request: NextRequest) {
  // Bypasses RLS - use carefully
  const {data} = await supabaseServiceRoleClient
    .from('table')
    .select('*')
}
```

### 4.4 Authentication: API Key (External Callers)

```typescript
import {validateTeamApiKey} from "@/libs/api-key"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const apiKey = authHeader?.split(' ')[1]

  const {teamId} = await request.json()
  const isValid = await validateTeamApiKey(teamId, apiKey)

  if (!isValid) {
    return NextResponse.json({error: 'Invalid API key'}, {status: 401})
  }
}
```

### 4.5 Response Format

```typescript
// Success
return NextResponse.json({
  data: result,
  message: "Operation successful"
}, {status: 200})

// Error
return NextResponse.json({
  error: "Description of what went wrong",
  details: {field: "value"}
}, {status: 400})

// Not Found
return NextResponse.json({
  error: "Resource not found"
}, {status: 404})
```

### 4.6 Request Validation

```typescript
import {z} from "zod"

const schema = z.object({
  name: z.string().min(1),
  teamId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const body = await request.json()
  const result = schema.safeParse(body)

  if (!result.success) {
    return NextResponse.json({
      error: "Validation failed",
      details: result.error.flatten()
    }, {status: 400})
  }

  // Use result.data (typed)
}
```

### 4.7 File Organization

```
/app/api/
├── agents/[id]/leads/           # Agent-specific lead management
├── campaigns/                   # Campaign management
│   ├── contact-enrollments/
│   └── enrollments/
├── contacts/                    # Contact CRUD operations
├── crons/                       # Scheduled tasks (register in vercel.json)
├── engagements/                 # User engagement tracking
│   ├── events/
│   └── trigger-actions/
├── internal-hooks/              # Internal webhooks
├── oauth/                       # Third-party authentication
│   ├── hubspot-crm/callback/
│   ├── salesforce/[teamSlug]/callback/
│   └── slack/callback/
├── tools/[botId]/               # Bot tool endpoints
├── threads/[threadId]/          # Chat thread management
│   ├── messages/
│   └── verify-otp/
└── webhook/                     # External service webhooks
    ├── hubspot/
    ├── retell/
    ├── stripe/
    ├── twilio/
    └── whatsapp/
```

Naming convention:
- `app/api/[resource]/route.ts` — CRUD operations
- `app/api/[resource]/[id]/route.ts` — Single resource operations
- `app/api/webhook/[service]/route.ts` — External webhooks
- `app/api/crons/[job]/route.ts` — Scheduled jobs
- `app/api/internal-hooks/[hook]/route.ts` — Internal webhooks

---

## 5. Database Migrations

### 5.1 Pre-Implementation

1. Never use Prisma — use native PostgreSQL SQL
2. Every table MUST have RLS policies
3. For transactional queries, use the pg lib at `lib/database.ts`

### 5.2 Create Migration

```bash
pnpm migrate:create [migration_name]
# Example: pnpm migrate:create add_user_preferences
```

### 5.3 Migration Template

```javascript
exports.up = pgm => {

  // REQUIRED: Enable RLS
  pgm.sql('ALTER TABLE table_name ENABLE ROW LEVEL SECURITY')

  // REQUIRED: Create policies
  pgm.sql(`
    CREATE POLICY select_table_name ON table_name FOR SELECT TO authenticated
    USING (table_name.team_id = ANY (user_teams()));

    CREATE POLICY insert_table_name ON table_name FOR INSERT TO authenticated
    WITH CHECK (table_name.team_id = ANY (user_teams()));

    CREATE POLICY update_table_name ON table_name FOR UPDATE TO authenticated
    USING (table_name.team_id = ANY (user_teams()));

    CREATE POLICY delete_table_name ON table_name FOR DELETE TO authenticated
    USING (table_name.team_id = ANY (user_teams()));
  `)

}

exports.down = pgm => {

}
```

### 5.4 Common Column Types

- `uuid` — IDs and foreign keys
- `varchar(n)` — Variable length string
- `text` — Unlimited text
- `integer` — Numbers
- `boolean` — True/false
- `timestamptz` — Timestamp with timezone
- `jsonb` — JSON data

### 5.5 After Migration

1. Update `/types/database.ts` with new types
2. Update `/types/index.ts` exports if needed
3. Run migration locally: `pnpm migrate`

### 5.6 Multi-Tenancy Rule (CRITICAL)

Every table MUST:

1. Have `team_id` column referencing `teams(id)`
2. Enable RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
3. Create CRUD policies using `user_teams()` function
4. Index on `team_id` for performance

---

## 6. AI/LLM Integration

### 6.1 LLM Providers

- **OpenAI**: GPT-4, GPT-4o (default)
- **Anthropic**: Claude models
- **Azure OpenAI**: Enterprise deployment (when USE_AZURE_OPENAI=true)

### 6.2 Factory Functions (ALWAYS use these)

```typescript
import {createOpenAILLM, createOpenAIEmbeddings} from "@/libs/llm-factory"

// Chat LLM
const llm = await createOpenAILLM({
  model: "gpt-4o",
  temperature: 0.7,
  teamId: chatBot.team_id  // Required for API key lookup
})

// Embeddings
const embeddings = await createOpenAIEmbeddings({
  model: "text-embedding-3-large",
  dimensions: 3072,
  teamId: "..."
})
```

### 6.3 Provider Selection Pattern

```typescript
import {ChatAnthropic} from "@langchain/anthropic"

if (chatBot.analyze_llm_provider === 'claude') {
  model = new ChatAnthropic({model: modelName})
} else if (chatBot.analyze_llm_provider === 'openai') {
  model = await createOpenAILLM({model: modelName, temperature: 1, teamId})
}
```

### 6.4 Key Reference Files

- `/libs/llm.ts` — Analysis functions
- `/libs/llm-factory.ts` — Instance factory
- `/libs/retriever.ts` — RAG retrieval
- `/libs/knowledge-base.ts` — Knowledge base operations
- `/lib/constants/ai-models.ts` — Model definitions

### 6.5 Prompt Templates

```typescript
import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate
} from "@langchain/core/prompts"

const prompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate("You are a helpful assistant..."),
  HumanMessagePromptTemplate.fromTemplate("{input}")
])

const chain = prompt.pipe(llm)
const response = await chain.invoke({input: userMessage})
```

### 6.6 Structured Output (JSON)

```typescript
const llmWithJsonResponse = llm.bind({
  response_format: {type: 'json_object'}
})
```

### 6.7 RAG Pattern

```typescript
import {createRetriever} from "@/libs/retriever"

const retriever = await createRetriever({
  teamId,
  botId,
  topK: 5
})

const relevantDocs = await retriever.getRelevantDocuments(query)
```

### 6.8 Team API Keys

```typescript
import {getOpenAIKeyByTeamId} from "@/libs/team"

const apiKey = await getOpenAIKeyByTeamId(teamId)
// Falls back to system key if team has no custom key
```

### 6.9 Monitoring

LLM calls are tracked via Langfuse for observability.

---

## 7. Queue Processors

### 7.1 When to Use Queues

- Tasks take >5s for synchronous API responses
- External webhooks may timeout waiting for response
- Tasks need automatic retry with backoff
- Deduplication is needed for idempotent processing

### 7.2 Architecture

```
API/Webhook → Queue (lib/scheduling.ts) → Worker (workers/index.ts) → Processor (workers/jobs/)
```

### 7.3 Step 1: Create Job Processor

Create `workers/jobs/[name]Processor.ts`:

```typescript
import {Job} from 'bullmq';
import {supabaseServiceRoleClient} from '@/libs/supabase';

export const MY_QUEUE_NAME = 'my-jobs';

export interface MyJobData {
  entityId: string;
  someUrl: string;
}

export async function processMyJob(job: Job<MyJobData>): Promise<void> {
  const {entityId, someUrl} = job.data;
  console.log(`Processing job ${job.id} for entity ${entityId}`);

  try {
    // 1. Check for deduplication (if needed)
    const {data: existing} = await supabaseServiceRoleClient
      .from('my_table')
      .select('processed_field')
      .eq('id', entityId)
      .single();

    if (existing?.processed_field) {
      console.log(`Already processed for ${entityId}, skipping`);
      return;
    }

    // 2. Do the heavy work
    const result = await doHeavyWork(someUrl);

    // 3. Update database atomically
    const {data: updateResult, error} = await supabaseServiceRoleClient
      .from('my_table')
      .update({processed_field: result})
      .eq('id', entityId)
      .is('processed_field', null)  // Only update if NULL (prevents race)
      .select();

    if (error) throw error;

    if (!updateResult || updateResult.length === 0) {
      console.log(`Another job already processed ${entityId}`);
      return;
    }

    console.log(`Job ${job.id} completed for ${entityId}`);
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Rethrow to trigger BullMQ retry
  }
}
```

### 7.4 Step 2: Add Queue Getter

Add to `lib/scheduling.ts`:

```typescript
import {Queue} from 'bullmq';
import {getBullMQRedisClient} from '@/workers/config/redis';

let myQueue: Queue | null = null;

export const getMyQueue = () => {
  if (!myQueue) {
    myQueue = new Queue('my-jobs', {
      connection: getBullMQRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });
  }
  return myQueue;
};
```

### 7.5 Step 3: Register Worker

Add to `workers/index.ts`:

```typescript
import {MY_QUEUE_NAME, processMyJob} from '@/workers/jobs/myProcessor';

const myWorker = new Worker(
  MY_QUEUE_NAME,
  processMyJob,
  {
    connection: redis,
    concurrency: 2,
    stalledInterval: 60000,
    maxStalledCount: 2,
    removeOnComplete: {count: 100},
    removeOnFail: {count: 50},
  }
);

gracefulShutdown.addWorker(myWorker);

myWorker.on('ready', () => console.log(`My worker is ready`));
myWorker.on('active', (job) => console.log(`Job ${job.id} started`));
myWorker.on('completed', (job, result) => console.log(`Job ${job.id} completed`));
myWorker.on('failed', (job, error) => console.error(`Job ${job?.id} failed:`, error.message));
myWorker.on('error', (error) => console.error('Worker error:', error));
```

### 7.6 Step 4: Queue Jobs from API/Webhook

```typescript
import {getMyQueue} from "@/lib/scheduling";
import type {MyJobData} from "@/workers/jobs/myProcessor";

try {
  const queue = getMyQueue();
  const jobData: MyJobData = {
    entityId: entity.id,
    someUrl: payload.url,
  };

  const job = await queue.add('process-entity', jobData, {
    jobId: `my-job-${entity.id}`,  // Prevents duplicate jobs
  });

  console.log(`Queued job ${job.id} for entity ${entity.id}`);
} catch (queueError) {
  console.error('Error queuing job:', queueError);
}

return NextResponse.json({success: true});
```

### 7.7 Concurrency Guidelines

| Task Type                       | Concurrency | Stalled Interval |
|---------------------------------|-------------|------------------|
| CPU-bound (parsing, processing) | 2-3         | 60s              |
| I/O-bound (API calls, uploads)  | 5-10        | 30s              |
| Memory-intensive (large files)  | 1-2         | 120s             |
| Quick tasks (notifications)     | 10-20       | 15s              |

### 7.8 Deduplication Patterns

**Job ID Deduplication:**

```typescript
await queue.add('job-name', data, {
  jobId: `unique-id-${entityId}`,
});
```

**Database-level Deduplication:**

```typescript
const {data} = await supabaseServiceRoleClient
  .from('table')
  .update({field: value})
  .eq('id', entityId)
  .is('field', null)  // Only update if NULL
  .select();

if (!data || data.length === 0) {
  console.log('Already processed by another job');
  return;
}
```

### 7.9 Error Handling

```typescript
export async function processMyJob(job: Job<MyJobData>): Promise<void> {
  try {
    // Main processing logic
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);

    if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
      await sendAlert(`Job ${job.id} permanently failed: ${error.message}`);
    }

    throw error; // Rethrow to trigger BullMQ retry
  }
}
```

### 7.10 Existing Queues Reference

| Queue             | Purpose                    | Concurrency |
|-------------------|----------------------------|-------------|
| `cron-jobs`       | Scheduled tasks            | 5           |
| `delayed-jobs`    | Scheduled calls/actions    | 10          |
| `indexing-jobs`   | Website/page indexing      | 3           |
| `automation-jobs` | Campaign automations       | 8           |
| `export-jobs`     | Data exports               | 2           |
| `simulation-jobs` | Agent simulations          | 5           |
| `recording-jobs`  | S3→Supabase transfer + STT | 2           |

### 7.11 File Organization

```
lib/
  scheduling.ts           # Queue getters (getMyQueue, etc.)
workers/
  index.ts                # Worker registration & startup
  config/
    redis.ts              # Redis client configuration
  jobs/
    myProcessor.ts        # Job processor function
  utils/
    gracefulShutdown.ts   # Shutdown handling
```
