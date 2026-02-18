# Contributing

Hey, thanks for being here. Here's how to not make a mess.

## Getting started

1. Fork and clone
2. Follow [docs/setup.md](docs/setup.md) to wire up Supabase, GCP, Cloudflare
3. `pnpm install && pnpm dev`

If you're just working on the UI, you only need Supabase. GCP and Cloudflare are only required if you're testing actual VM provisioning.

## Dev workflow

```bash
pnpm dev          # localhost:3000, auth bypassed
pnpm build        # Make sure prod build doesn't explode
pnpm lint         # ESLint
```

Dev mode gives you:
- Auto-login as `dev@revve.ai`
- Cloudflare Access creation skipped
- WebSocket shell auth skipped

## Project layout

```
src/
├── app/          # Pages and API routes (Next.js App Router)
├── components/   # React components
├── lib/          # Core logic
│   ├── supabase/ # DB clients and types
│   ├── providers/# VM lifecycle
│   └── clouds/   # Cloud abstraction (GCP)
└── types/        # Shared interfaces
```

[docs/architecture.md](docs/architecture.md) has the full picture.

## Conventions

- **TypeScript everywhere**. No `any` unless something is truly unknowable.
- **Database columns are `snake_case`**. TypeScript types match them directly.
- **Two Supabase clients**: `supabaseAdmin` bypasses RLS (system ops), `createClient()` respects it (user-facing reads). Don't mix them up.
- **API responses** always look like `{ success: true, data }` or `{ success: false, error }`.
- **Long-running stuff** (provisioning, deploy, start) streams via SSE using `sseResponse()` from `src/lib/sse.ts`.
- **Tailwind CSS 4**. No CSS modules, no styled-components, no drama.

## Migrations

[node-pg-migrate](https://github.com/salsita/node-pg-migrate) with raw SQL.

```bash
pnpm db:migrate:new my-migration-name  # scaffold
pnpm db:migrate                         # apply
pnpm db:migrate:down                    # undo last
```

New tables need RLS policies. Look at `migrations/002_rls-policies.js` for the pattern.

## Adding cloud providers

Want to add Hetzner, AWS, or something else? [docs/adding-cloud-providers.md](docs/adding-cloud-providers.md) walks through the whole thing.

## Security stuff (please read this part)

This project manages real infrastructure and SSH keys. Treat it accordingly.

- Port 18789 goes through Cloudflare Tunnel. **Never** open it in UFW.
- Secrets stay on the server. Never in client code, never in git.
- `supabaseAdmin` is server-only. If you're importing it in a client component, stop.
- SSH keys live in `data/.ssh/` — gitignored for a reason.

## Submitting changes

1. Branch off `main`
2. Do your thing
3. `pnpm build && pnpm lint` — both green
4. PR with a clear description of what you changed and why
