# Crawfleet

One [OpenClaw](https://openclaw.ai) instance per employee. Dedicated VMs. Private subdomains. Zero config on their end. You just click a button.

Crawfleet is a self-hosted dashboard that provisions and manages per-user OpenClaw instances on GCP VMs. Each person gets `alice.openclaw.company.com`, their own isolated box, and only the API keys you decide to give them. No forks. No patches. Just fleet management that stays out of OpenClaw's way.

## The pitch

- **One VM per person** — not containers sharing a host, actual isolated VMs
- **Zero-trust by default** — everything routes through Cloudflare Tunnels. No public ports. Not even SSH after setup. Paranoid? Good.
- **Per-user access control** — Cloudflare Access locks each subdomain to one email. Nobody's sneaking into someone else's instance
- **Centralized API keys** — set Anthropic/OpenAI/Gemini keys fleet-wide, override per user. Three-tier fallback so you don't repeat yourself
- **Live ops from the browser** — web terminal, log streaming, start/stop/restart/deploy. No SSHing around
- **Audit trail** — every action logged. Because "who restarted prod?" shouldn't be a mystery

## How it works

```
┌──────────────────────────────────────────────┐
│              Cloudflare Edge                 │
│    (Access auth per subdomain)               │
└──────┬────────────────────┬──────────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐   ┌──────────────────────┐
│  Crawfleet   │   │  Tenant VM (alice)   │
│  Tunnel      │   │  Tunnel              │
│  ─────────── │   │  ──────────────────  │
│  cloudflared │   │  cloudflared         │
│  → :3000     │   │  → localhost:18789   │
└──────────────┘   └──────────────────────┘
     Dashboard           OpenClaw Gateway
                         (per user)
```

## Built with

Next.js 15 / React 19 / Tailwind 4 / xterm.js / Supabase (Postgres + Auth + RLS) / GCP Compute / Cloudflare Tunnels + Access / ssh2 / node-pg-migrate

## Quick start

Full walkthrough in [docs/setup.md](docs/setup.md). Here's the speedrun:

```bash
git clone https://github.com/your-org/crawfleet.git
cd crawfleet
pnpm install

cp .env.example .env
# Fill in Supabase, Cloudflare, GCP credentials

pnpm db:migrate
pnpm dev
```

Dashboard at `http://localhost:3000`. Dev mode skips auth so you can poke around immediately.

## Docs

| | |
|-|-|
| [docs/setup.md](docs/setup.md) | Getting everything wired up — Supabase, GCP, Cloudflare, SSH keys |
| [docs/architecture.md](docs/architecture.md) | How things actually work under the hood |
| [docs/deployment.md](docs/deployment.md) | Shipping to production on GCP + Cloudflare |
| [docs/api.md](docs/api.md) | Every API endpoint, documented |
| [docs/adding-cloud-providers.md](docs/adding-cloud-providers.md) | Want Hetzner? AWS? Here's how |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Ground rules for contributors |

## Commands

```bash
pnpm dev              # Dev server (auth bypassed, hot reload)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm db:migrate       # Run migrations
pnpm db:migrate:down  # Undo last migration
pnpm db:migrate:new   # Scaffold a new migration
```

## License

MIT
