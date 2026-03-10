# API Reference

All endpoints require a Supabase session cookie (browser) or access token. Endpoints marked **admin** require `app_metadata.role = "admin"`.

Base URL: `https://fleet.yourdomain.com` (production) or `http://localhost:3000` (development)

---

## Tenants

### List tenants
```
GET /api/tenants
```

Returns all tenants for admins, or only the authenticated user's tenants for regular users.

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

Returns an **SSE stream** because VM provisioning takes 2-5 minutes.

**Request body:**
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

**On failure:**
```
data: {"error":"Setup script failed (exit 1): ..."}
```

### Get tenant
```
GET /api/tenants/{slug}
```

Returns tenant details including VPS instance data.

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

Note: `envOverrides` changes do not take effect until the tenant is redeployed. Environment variables are written to the VM's env file during deployment.

### Delete tenant — **admin**
```
DELETE /api/tenants/{slug}
```

Deletes the Cloudflare Tunnel, Cloudflare Access app, and GCP VM. This action is irreversible.

---

## Tenant Operations

### Start — **admin**
```
POST /api/tenants/{slug}/start
```

Starts the VM if it is stopped and starts the OpenClaw service. Returns an SSE stream.

### Stop — **admin**
```
POST /api/tenants/{slug}/stop
```

Stops the OpenClaw service. The VM remains running to keep the tunnel connection alive.

### Restart — **admin**
```
POST /api/tenants/{slug}/restart
```

Runs `systemctl restart openclaw` on the VM.

### Deploy — **admin**
```
POST /api/tenants/{slug}/deploy
```

Updates environment variables and re-runs the OpenClaw installer. Returns an SSE stream.

**Optional request body:**
```json
{ "gitTag": "v1.2.3" }
```

### Health check
```
GET /api/tenants/{slug}/health
```

Checks the tenant's OpenClaw instance through its Cloudflare Tunnel.

```json
{ "success": true, "data": { "status": "healthy" } }
```

### Logs
```
GET /api/tenants/{slug}/logs
```

Returns an SSE stream of `journalctl -u openclaw -f` output. The stream continues until the client disconnects.

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

Returns available cloud providers, regions, and machine types for tenant creation.

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

Returns fleet-wide API keys and configuration.

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

## Error responses

All errors follow this format:

```json
{ "success": false, "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| 401 | Not authenticated |
| 403 | Authenticated but not authorized (not an admin, or not the tenant owner) |
| 404 | Tenant not found |
| 500 | Internal server error |
