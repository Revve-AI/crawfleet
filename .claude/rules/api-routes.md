---
paths:
  - "app/api/**/*.ts"
---

# API Route Rules (Auto-applied)

## Response Format

```typescript
// Success
return NextResponse.json({ data, message }, { status: 200 })

// Error
return NextResponse.json({ error: "message", details }, { status: 4xx })
```

## Authentication Patterns

- User session: `createRouteHandlerClient({ cookies })`
- Service role: `supabaseServiceRoleClient` from `/libs/supabase.ts`
- External API: Validate API key header

## Request Validation

Always validate request body with Zod schema before processing.

## File Organization

- `app/api/[resource]/route.ts` - CRUD operations
- `app/api/webhook/[service]/route.ts` - External webhooks
- `app/api/crons/[job]/route.ts` - Scheduled jobs
