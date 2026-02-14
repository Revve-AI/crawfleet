---
paths:
  - "migrations/**/*.js"
---

# Migration Rules (Auto-applied)

## REQUIRED for every new table:

1. `team_id` column referencing `teams(id)`
2. Enable RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
3. CRUD policies using `user_teams()` function
4. Index on `team_id`

## Policy Template

```sql
CREATE POLICY select_[table] ON [table] FOR SELECT TO authenticated
  USING ([table].team_id = ANY (user_teams()));

CREATE POLICY insert_[table] ON [table] FOR INSERT TO authenticated
  WITH CHECK ([table].team_id = ANY (user_teams()));

CREATE POLICY update_[table] ON [table] FOR UPDATE TO authenticated
  USING ([table].team_id = ANY (user_teams()));

CREATE POLICY delete_[table] ON [table] FOR DELETE TO authenticated
  USING ([table].team_id = ANY (user_teams()));
```

## After migration:

- Update `/types/database.ts` with new types
- Update `/types/index.ts` exports if needed
- Run `pnpm migrate` locally to test
