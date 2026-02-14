---
paths:
  - "libs/**/*.ts"
---

# Library Rules (Auto-applied)

## Supabase Client Usage

- `supabaseServiceRoleClient` bypasses RLS - use carefully and only when necessary
- For user operations, prefer session-based client

## Service Role Client

```typescript
import { supabaseServiceRoleClient } from "@/libs/supabase"
// Only use for:
// - Cron jobs
// - Webhook handlers
// - Internal operations without user context
```

## Naming Conventions

- External services: `hubspot.ts`, `salesforce.ts`, `stripe.ts`
- Domain logic: `contact.ts`, `thread.ts`, `chatBot.ts`
- Utilities: `signature.ts`, `cors.ts`, `csv-parser.ts`

## Key Files Reference

- `supabase.ts` - Service role client
- `llm-factory.ts` - LLM instance factory
- `logger.ts` - Logging utilities
- `team.ts` - Team operations
