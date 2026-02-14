---
paths:
  - "action/**/*.ts"
---

# Server Action Rules (Auto-applied)

## Required Directive

Every file MUST start with: `"use server"`

## Authentication Pattern

```typescript
const supabase = createServerActionClient({ cookies })
const { data: { session } } = await supabase.auth.getSession()
if (!session) return { success: false, error: "UNAUTHORIZED" }
```

## Return Type Pattern

```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }
```

## Logging Wrapper

Use `withServerAction` from `/libs/logger.ts` for centralized logging:

```typescript
export async function myAction(id: string) {
  return withServerAction("myAction", async () => {
    // ... implementation
  })
}
```

## Revalidation

After mutations, call `revalidatePath()` to update cache:

```typescript
import { revalidatePath } from "next/cache"
revalidatePath('/dashboard/[teamSlug]/chatbots')
```
