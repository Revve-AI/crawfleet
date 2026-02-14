---
paths:
  - "components/**/*.tsx"
  - "app/**/*.tsx"
---

# Component Rules (Auto-applied)

## Design System (CRITICAL)

- NEVER use hardcoded hex colors like `bg-[#E65c1a]`
- ALWAYS use semantic tokens: `bg-primary`, `text-primary`, `text-muted-foreground`
- Cards use `shadow-none` class

## Before Creating New Component

1. Check `components/ui/` for existing base component
2. Check similar feature components in `components/`
3. Follow existing patterns in the codebase

## Form Handling

- Use react-hook-form with zodResolver
- Schema in `lib/schema/` or colocated
- Field components from `components/ui/form.tsx`

## State Management

- URL state for filters/pagination: `useSearchParams`
- Server state: React Query
- Form state: React Hook Form

## Import Pattern

```typescript
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
```
