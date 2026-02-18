# API Reference

All endpoints need a Supabase session cookie (browser) or access token. Endpoints marked **admin** require `app_metadata.role = "admin"`.

Base: `https://fleet.yourdomain.com` (prod) / `http://localhost:3000` (dev)

---

## Tenants

### List tenants
```
GET /api/tenants
```

Admins see everyone. Regular users see their own. That's RLS doing its thing.

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "slug": "alice",
      "display_name": "Alice",
      "email": "alice@company.com",
      "enabled": true,
      "status": "running",
      "last_health_status": "healthy",
      "vps_instances": {
        "cloud": "gcp",
        "region": "us-central1-a",
        "machine_type": "e2-small",
        "vm_status": "running",
        "git_tag": "latest"
      }
    }
  ]
}
```

### Create tenant — **admin**
```
POST /api/tenants
```

This one's special — it returns an **SSE stream** because provisioning a whole VM takes 2-5 minutes. Don't try to `await` this as JSON. You'll be waiting a while.

**Body:**
```json
{
  "slug": "alice",
  "displayName": "Alice",
  "email": "alice@company.com",
  "cloud": "gcp",
  "machineType": "e2-small",
  "region": "us-central1-a",
  "gitTag": "latest",
  "envOverrides": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```

**SSE events:**
```
data: {"status":"Creating VM instance"}
data: {"status":"Waiting for VM to boot"}
data: {"status":"Hardening OS and installing dependencies"}
data: {"status":"Creating Cloudflare Tunnel"}
data: {"status":"Installing tunnel connector"}
data: {"status":"Starting OpenClaw"}
data: {"status":"Waiting for health check (30s, status: unknown)"}
data: {"done":true,"tenant":{...}}
```

If it blows up:
```
data: {"error":"Setup script failed (exit 1): ..."}
```

### Get tenant
```
GET /api/tenants/{slug}
```

Returns tenant details + VPS instance data.

### Update tenant — **admin**
```
PATCH /api/tenants/{slug}
```

```json
{
  "displayName": "Alice Updated",
  "enabled": false,
  "envOverrides": {
    "ANTHROPIC_API_KEY": "sk-ant-new-key"
  }
}
```

Heads up: `envOverrides` changes don't take effect until you redeploy. They're baked into the VM's env file.

### Delete tenant — **admin**
```
DELETE /api/tenants/{slug}
```

Nukes everything: Cloudflare Tunnel, Access app, GCP VM. Gone.

---

## Tenant Operations

### Start — **admin**
```
POST /api/tenants/{slug}/start
```

Boots the VM if it's off, starts the OpenClaw service. SSE stream.

### Stop — **admin**
```
POST /api/tenants/{slug}/stop
```

Stops OpenClaw. VM stays up to keep the tunnel alive.

### Restart — **admin**
```
POST /api/tenants/{slug}/restart
```

`systemctl restart openclaw` on the VM. Quick and dirty.

### Deploy — **admin**
```
POST /api/tenants/{slug}/deploy
```

Updates env vars and re-runs the OpenClaw installer. SSE stream.

Optional body:
```json
{ "gitTag": "v1.2.3" }
```

### Health check
```
GET /api/tenants/{slug}/health
```

Pings the tenant's OpenClaw through its Cloudflare Tunnel.

```json
{ "success": true, "data": { "status": "healthy" } }
```

### Logs
```
GET /api/tenants/{slug}/logs
```

SSE stream of `journalctl -u openclaw -f`. Keeps streaming until you disconnect.

### Shell (WebSocket)
```
WS /api/tenants/{slug}/shell?access_token=...
```

Full interactive terminal. Connects through the Cloudflare Tunnel via SSH. Needs a Supabase access token as a query param.

**Client → Server:**
```json
{"type": "input", "data": "ls\n"}
{"type": "resize", "cols": 80, "rows": 24}
```

**Server → Client:**
```json
{"type": "output", "data": "file1.txt\nfile2.txt\n"}
{"type": "exit"}
{"type": "error", "message": "VPS not ready"}
```

---

## Fleet

### Health summary
```
GET /api/health
```

```json
{
  "success": true,
  "data": {
    "total": 10,
    "running": 8,
    "stopped": 1,
    "healthy": 7,
    "unhealthy": 1
  }
}
```

### Cloud providers — **admin**
```
GET /api/clouds
```

Returns what's available for creating new tenants.

```json
{
  "success": true,
  "data": [
    {
      "id": "gcp",
      "name": "Google Cloud",
      "regions": [
        { "id": "us-central1-a", "description": "Iowa, US" }
      ],
      "machineTypes": [
        { "id": "e2-small", "description": "e2-small (2 vCPU, 2 GB) — ~$14/mo" }
      ]
    }
  ]
}
```

---

## Settings

### Get settings — **admin**
```
GET /api/settings
```

Fleet-wide API keys and config.

### Update settings — **admin**
```
PUT /api/settings
```

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENAI_API_KEY": "sk-..."
}
```

---

## Auth

### Logout
```
POST /api/auth/logout
```

Clears the Supabase session.

---

## Errors

Every error looks like this:

```json
{ "success": false, "error": "what went wrong" }
```

| Status | Meaning |
|--------|---------|
| 401 | Not logged in |
| 403 | Logged in but not allowed (not admin, not your tenant) |
| 404 | Tenant doesn't exist |
| 500 | Something broke. Check server logs. |
