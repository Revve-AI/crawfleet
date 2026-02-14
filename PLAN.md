 OpenClaw Fleet Manager -- Implementation Plan

 Overview

 A Next.js + TypeScript management dashboard that provisions and manages per-employee OpenClaw instances as Docker containers on a single server. Each employee gets their own subdomain (alice.openclaw.company.com), own OpenClaw config, and
 isolated state. The admin dashboard controls which AI providers, tools, and capabilities each employee can access -- all without modifying OpenClaw's code.

 Stack: Next.js 15 (App Router) + Prisma (SQLite) + dockerode + Traefik + iron-session

 ---
 Architecture

 Server (4-8GB RAM)
 ├── Traefik (:80/:443) ─── wildcard TLS via Let's Encrypt DNS challenge
 │   ├── fleet.openclaw.company.com  → Dashboard (:3000)
 │   ├── alice.openclaw.company.com  → fleet-alice container (:18789)
 │   ├── bob.openclaw.company.com    → fleet-bob container (:18789)
 │   └── ...
 ├── Dashboard (Next.js, :3000) ─── manages containers via Docker socket
 ├── fleet-alice (openclaw/openclaw:latest) ─── Alice's isolated instance
 ├── fleet-bob (openclaw/openclaw:latest) ─── Bob's isolated instance
 └── data/
     ├── fleet.db (SQLite)
     └── tenants/{slug}/.openclaw/  (per-tenant state + config)

 How Access Control Works (no OpenClaw code changes)
 ┌────────────────────┬──────────────────────────────────────────────┬─────────────────┐
 │      Control       │                  Mechanism                   │ Restart needed? │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Which AI providers │ Inject/omit *_API_KEY env vars per container │ Yes             │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Which model        │ agents.list[0].model in openclaw.json        │ No (hot-reload) │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Shell/exec access  │ agents.list[0].tools.exec.security in config │ No (hot-reload) │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Browser access     │ browser.enabled in config                    │ No (hot-reload) │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Web search         │ Inject/omit BRAVE_API_KEY env var            │ Yes             │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Voice/TTS          │ Inject/omit ELEVENLABS_API_KEY env var       │ Yes             │
 ├────────────────────┼──────────────────────────────────────────────┼─────────────────┤
 │ Channels           │ channels.* section in config                 │ No (hot-reload) │
 └────────────────────┴──────────────────────────────────────────────┴─────────────────┘
 ---
 Project Structure

 openclaw-fleet/
 ├── docker-compose.yml              # Traefik + Dashboard (infra only)
 ├── .env.example                    # All required env vars
 ├── Dockerfile                      # Dashboard image
 ├── package.json
 ├── tsconfig.json
 ├── next.config.ts
 ├── prisma/
 │   └── schema.prisma               # SQLite schema
 ├── src/
 │   ├── app/
 │   │   ├── layout.tsx              # Root layout + auth guard
 │   │   ├── page.tsx                # Dashboard home (fleet overview)
 │   │   ├── login/page.tsx          # Admin login
 │   │   ├── tenants/
 │   │   │   ├── page.tsx            # Tenant list
 │   │   │   ├── new/page.tsx        # Create tenant form
 │   │   │   └── [slug]/
 │   │   │       ├── page.tsx        # Tenant detail + edit
 │   │   │       └── logs/page.tsx   # Live log viewer
 │   │   ├── settings/page.tsx       # Global settings (API keys status, domain)
 │   │   └── api/
 │   │       ├── auth/
 │   │       │   ├── login/route.ts
 │   │       │   └── logout/route.ts
 │   │       ├── tenants/
 │   │       │   ├── route.ts                    # GET list, POST create
 │   │       │   └── [slug]/
 │   │       │       ├── route.ts                # GET, PATCH, DELETE
 │   │       │       ├── start/route.ts
 │   │       │       ├── stop/route.ts
 │   │       │       ├── restart/route.ts
 │   │       │       ├── health/route.ts
 │   │       │       └── logs/route.ts           # SSE streaming
 │   │       └── health/route.ts                 # Fleet-wide summary
 │   ├── lib/
 │   │   ├── db.ts                   # Prisma singleton
 │   │   ├── docker.ts               # Container lifecycle (dockerode)
 │   │   ├── config-template.ts      # openclaw.json generator
 │   │   ├── auth.ts                 # Admin session (iron-session)
 │   │   ├── crypto.ts               # Token generation
 │   │   ├── health-monitor.ts       # Background polling
 │   │   └── constants.ts            # Image name, network, labels
 │   ├── components/
 │   │   ├── TenantCard.tsx
 │   │   ├── TenantForm.tsx
 │   │   ├── ProviderToggles.tsx
 │   │   ├── StatusBadge.tsx
 │   │   ├── ContainerLogs.tsx
 │   │   └── FleetStats.tsx
 │   └── types/index.ts
 ├── scripts/
 │   ├── setup.sh                    # Server bootstrap
 │   └── seed.ts                     # Create admin user
 └── data/                           # gitignored, host-mounted volume
     ├── fleet.db
     └── tenants/

 ---
 Database Schema (prisma/schema.prisma)

 datasource db {
   provider = "sqlite"
   url      = env("DATABASE_URL")
 }

 generator client {
   provider = "prisma-client-js"
 }

 model Tenant {
   id              String   @id @default(cuid())
   slug            String   @unique       // subdomain: alice → alice.openclaw.company.com
   displayName     String                 // "Alice Smith"
   email           String?

   // Status
   enabled         Boolean  @default(true)
   containerId     String?                // Docker container ID
   containerStatus String   @default("stopped") // running | stopped | error

   // Provider access (shared API keys -- inject env var if true)
   allowAnthropic  Boolean  @default(true)
   allowOpenAI     Boolean  @default(false)
   allowGemini     Boolean  @default(false)
   allowBrave      Boolean  @default(false)   // web search
   allowElevenLabs Boolean  @default(false)   // voice

   // Agent config (written to openclaw.json)
   defaultModel    String   @default("anthropic:claude-sonnet-4-5-20250929")
   execSecurity    String   @default("deny")   // deny | allowlist | full
   browserEnabled  Boolean  @default(false)

   // Auth
   gatewayToken    String                      // unique per tenant, crypto.randomBytes(32)

   // Health
   lastHealthCheck  DateTime?
   lastHealthStatus String?                    // healthy | unhealthy | unknown

   createdAt       DateTime @default(now())
   updatedAt       DateTime @updatedAt

   auditLogs       AuditLog[]
 }

 model AuditLog {
   id        String   @id @default(cuid())
   tenantId  String?
   tenant    Tenant?  @relation(fields: [tenantId], references: [id], onDelete: SetNull)
   action    String                            // tenant.created | tenant.started | config.updated
   details   String?                           // JSON
   createdAt DateTime @default(now())
   @@index([tenantId])
   @@index([createdAt])
 }

 ---
 Docker Compose (infrastructure only)

 # docker-compose.yml -- Traefik + Dashboard only
 # Tenant containers are created dynamically via Docker API

 services:
   traefik:
     image: traefik:v3.2
     command:
       - "--providers.docker=true"
       - "--providers.docker.exposedbydefault=false"
       - "--providers.docker.network=fleet-proxy"
       - "--entrypoints.web.address=:80"
       - "--entrypoints.websecure.address=:443"
       - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
       - "--certificatesresolvers.le.acme.dnschallenge=true"
       - "--certificatesresolvers.le.acme.dnschallenge.provider=${DNS_PROVIDER}"
       - "--certificatesresolvers.le.acme.email=${ACME_EMAIL}"
       - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
     ports:
       - "80:80"
       - "443:443"
     volumes:
       - /var/run/docker.sock:/var/run/docker.sock:ro
       - letsencrypt:/letsencrypt
     networks:
       - fleet-proxy
     restart: unless-stopped

   dashboard:
     build: .
     env_file: .env
     volumes:
       - ./data:/app/data
       - /var/run/docker.sock:/var/run/docker.sock
     labels:
       - "traefik.enable=true"
       - "traefik.http.routers.dashboard.rule=Host(`fleet.${BASE_DOMAIN}`)"
       - "traefik.http.routers.dashboard.entrypoints=websecure"
       - "traefik.http.routers.dashboard.tls.certresolver=le"
       - "traefik.http.routers.dashboard.tls.domains[0].main=${BASE_DOMAIN}"
       - "traefik.http.routers.dashboard.tls.domains[0].sans=*.${BASE_DOMAIN}"
       - "traefik.http.services.dashboard.loadbalancer.server.port=3000"
     networks:
       - fleet-proxy
     restart: unless-stopped
     depends_on:
       - traefik

 networks:
   fleet-proxy:
     name: fleet-proxy

 volumes:
   letsencrypt:

 ---
 Core Implementation Details

 1. Container Creation (src/lib/docker.ts)

 Key function: createTenantContainer(tenant):

 - Image: openclaw/openclaw:latest (from env OPENCLAW_IMAGE)
 - Command: ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan", "--port", "18789"]
   - --allow-unconfigured required to skip onboarding wizard (confirmed: Dockerfile line 48)
   - --bind lan required so container listens on 0.0.0.0 (Traefik routes to it)
 - Volumes: data/tenants/{slug}/.openclaw:/home/node/.openclaw
 - Network: fleet-proxy (same as Traefik, so routing works by container name)
 - Resource limits: Memory: 256MB, MemoryReservation: 128MB
 - Env vars: Selectively injected based on tenant's allow* flags:
 HOME=/home/node
 TERM=xterm-256color
 OPENCLAW_GATEWAY_TOKEN=<tenant.gatewayToken>
 ANTHROPIC_API_KEY=<if allowAnthropic>
 OPENAI_API_KEY=<if allowOpenAI>
 GEMINI_API_KEY=<if allowGemini>
 BRAVE_API_KEY=<if allowBrave>
 ELEVENLABS_API_KEY=<if allowElevenLabs>
 - Labels: Traefik routing labels applied programmatically:
 traefik.enable=true
 traefik.http.routers.{slug}.rule=Host(`{slug}.{BASE_DOMAIN}`)
 traefik.http.routers.{slug}.entrypoints=websecure
 traefik.http.routers.{slug}.tls.certresolver=le
 traefik.http.services.{slug}.loadbalancer.server.port=18789
 - Init: true (dumb-init, matches upstream docker-compose.yml)
 - Restart: unless-stopped
 - User: Runs as node (UID 1000) inside the published image

 2. Config Template (src/lib/config-template.ts)

 Generates openclaw.json per tenant. Critical fields:

 function generateConfig(tenant: Tenant, baseDomain: string): object {
   return {
     gateway: {
       port: 18789,
       bind: "lan",
       auth: { mode: "token" },
       controlUi: {
         enabled: true,
         allowedOrigins: [`https://${tenant.slug}.${baseDomain}`],
       },
       // CRITICAL: trust Traefik proxy so X-Forwarded-For is honored
       trustedProxies: ["172.16.0.0/12", "10.0.0.0/8"],
     },
     agents: {
       list: [{
         id: "default",
         default: true,
         model: tenant.defaultModel,
         tools: {
           exec: { security: tenant.execSecurity },
         },
       }],
     },
     browser: { enabled: tenant.browserEnabled },
     logging: { level: "info" },
   };
 }

 The trustedProxies field is essential -- without it, requests through Traefik would fail auth because the gateway wouldn't trust the forwarded headers.

 3. Tenant Lifecycle

 Create:
 1. Validate slug (alphanumeric + hyphens, 3-20 chars, unique)
 2. Generate gatewayToken via crypto.randomBytes(32).toString('hex')
 3. Insert Tenant record in SQLite
 4. Create host dirs: data/tenants/{slug}/.openclaw/
 5. Write openclaw.json from template
 6. Create Docker container with Traefik labels
 7. Start container
 8. Log audit event

 Update (config change only -- model, exec, browser):
 1. Update DB record
 2. Rewrite openclaw.json
 3. Gateway hot-reloads within 200ms (no restart needed)
 4. Log audit event

 Update (provider access change):
 1. Update DB record
 2. Rewrite openclaw.json
 3. Stop container → Remove container → Recreate container with new env vars → Start
 4. Log audit event

 Stop/Start/Restart: Direct Docker API calls + DB status update

 Delete:
 1. Stop and remove container
 2. Optionally remove data/tenants/{slug}/ directory
 3. Delete DB record
 4. Log audit event

 4. Health Monitoring (src/lib/health-monitor.ts)

 Use Docker container health inspection (simpler than WebSocket RPC):

 - Add Healthcheck to container creation:
 Test: ["CMD", "node", "-e",
   "fetch('http://localhost:18789/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
 Interval: 30s, Timeout: 5s, Retries: 3
 - Poll via docker.getContainer(id).inspect() → read .State.Health.Status
 - Update lastHealthCheck and lastHealthStatus in DB every 30s
 - Dashboard UI polls /api/health for fleet-wide status

 5. Admin Auth (src/lib/auth.ts)

 - iron-session for encrypted stateless cookies
 - Single admin user, password hash stored in env ADMIN_PASSWORD_HASH
 - Session: 24h TTL, httpOnly, secure, sameSite=lax
 - All API routes check session before proceeding

 ---
 Build Sequence

 Phase 1: Project Scaffold (Day 1)

 1. npx create-next-app@latest openclaw-fleet --typescript --tailwind --app --src-dir
 2. Install deps: prisma, @prisma/client, dockerode, @types/dockerode, iron-session, bcrypt
 3. Set up Prisma with SQLite schema, run initial migration
 4. Create src/lib/db.ts, src/lib/auth.ts, src/lib/constants.ts, src/lib/crypto.ts
 5. Build login page + API route
 6. Build root layout with auth guard
 7. Create scripts/seed.ts for initial admin

 Phase 2: Docker Integration (Day 2-3)

 8. Implement src/lib/docker.ts -- full container lifecycle
 9. Implement src/lib/config-template.ts -- OpenClaw config generator
 10. Test manually: create a container via code, verify it starts and gateway responds

 Phase 3: API Routes (Day 3-4)

 11. POST /api/tenants -- create tenant end-to-end
 12. GET /api/tenants -- list with live Docker status
 13. GET/PATCH/DELETE /api/tenants/[slug] -- detail, update, delete
 14. Start/stop/restart routes
 15. Health and logs routes

 Phase 4: Dashboard UI (Day 5-6)

 16. Tenant list page with status badges
 17. Create tenant form (slug, name, provider toggles, model select, exec dropdown)
 18. Tenant detail/edit page
 19. Container log viewer (SSE streaming)
 20. Fleet stats component (RAM, running count)

 Phase 5: Traefik + TLS + Server Setup (Day 7)

 21. Write docker-compose.yml with Traefik config
 22. Write Dockerfile for dashboard
 23. Write scripts/setup.sh (Docker install, network create, image pull, env setup)
 24. Write .env.example with documentation
 25. Configure DNS (A record + wildcard A record)
 26. Test end-to-end on real server

 Phase 6: Polish (Day 8)

 27. Health monitoring background service
 28. Audit log viewer
 29. Error handling and edge cases
 30. README with setup instructions

 ---
 Verification Plan

 1. Admin login: Navigate to fleet.openclaw.company.com, login works
 2. Create tenant: Create "alice", verify container in docker ps, verify openclaw.json written
 3. Subdomain access: alice.openclaw.company.com loads OpenClaw Control UI
 4. Provider isolation: Create "bob" with only OpenAI, verify ANTHROPIC_API_KEY absent from env
 5. Config hot-reload: Change Alice's model in dashboard, verify no restart, model changes
 6. Provider change restart: Toggle OpenAI for Alice, verify container restarts
 7. Health status: Dashboard shows green for running, red for stopped
 8. Logs: View live container logs from dashboard
 9. Delete: Remove Bob, verify container gone, subdomain returns 404
 10. Scale: Create 15 tenants, verify server RAM stays under 6GB

 ---
 Server Requirements

 - OS: Ubuntu 22.04+ or Debian 12+
 - RAM: 4GB (10 tenants) or 8GB (15 tenants)
 - CPU: 2-4 vCPU
 - Disk: 20GB+ SSD
 - Network: Static IP, ports 80 + 443 open
 - DNS: Wildcard A record *.openclaw.company.com pointing to server IP
 - Cost estimate: Hetzner CPX21 (3 vCPU, 4GB) ~$8/mo or CPX31 (4 vCPU, 8GB) ~$15/mo
