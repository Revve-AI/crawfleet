# Plan: Hetzner Cloud Provider Integration

## Overview

Add Hetzner Cloud as a pluggable cloud provider alongside the existing GCP implementation. The architecture already supports this — `src/lib/clouds/index.ts` has a Hetzner entry in `listAvailableClouds()` gated on `HETZNER_API_TOKEN`, and `docs/adding-cloud-providers.md` outlines the pattern. This plan covers the full implementation.

## Scope

**In scope:** Hetzner `CloudProvider` implementation, factory registration, env config, and any minor UI/constant updates needed.

**Out of scope:** Changes to the `TenantProvider` / `VpsProvider` layer (it's cloud-agnostic by design), changes to setup scripts (they use `apt` which works on Debian/Ubuntu from Hetzner), changes to Tailscale/Cloudflare integration.

---

## Step-by-step Implementation

### Step 1: Install the Hetzner API client

Install the official Hetzner Cloud JS/TS SDK:

```bash
pnpm add hcloud-js
```

**Alternative:** Use raw `fetch` calls against the Hetzner API (`https://api.hetzner.cloud/v1/`). The API is simple enough (REST + JSON) that a lightweight fetch wrapper may be preferable to avoid a dependency. The GCP implementation uses `@google-cloud/compute` because the GCP API is complex (gRPC, LROs, etc.), but Hetzner's API is straightforward REST.

**Recommendation:** Use raw `fetch` — no additional dependency, keeps the implementation lean, and Hetzner's API is well-documented with simple JSON request/response patterns.

---

### Step 2: Create `src/lib/clouds/hetzner.ts`

Implement the `CloudProvider` interface. Key mapping decisions:

#### `createVm(spec: VmSpec): Promise<string>`

- **API:** `POST /v1/servers`
- **Image:** `debian-12` (matches GCP's Debian 12 choice — setup scripts use `apt`)
- **SSH key:** Hetzner requires uploading the SSH key first via `POST /v1/ssh_keys`, then referencing it by ID. Strategy:
  - On first call, upload the fleet SSH key and cache the Hetzner SSH key ID
  - On subsequent calls, reuse the cached ID
  - Handle "key already exists" (409) gracefully by fetching existing key by fingerprint
- **User data:** Hetzner supports `user_data` (cloud-init) — can be used for `spec.startupScript` if provided, but the current flow doesn't use startup scripts (VpsProvider SSHes in post-creation instead)
- **Server name:** Use `spec.name` (which is `fleet-{slug}`)
- **Location:** Map `spec.region` directly (Hetzner uses `fsn1`, `nbg1`, `hel1`, `ash`, `hil`)
- **Server type:** Map `spec.machineType` directly (Hetzner uses `cx22`, `cx32`, `cx42`, etc.)
- **Labels:** Map `spec.tags` to Hetzner labels (`{ "fleet": "true", "tenant": slug }`)
- **Return:** Server ID as string

#### `waitForReady(instanceId, region, timeoutMs): Promise<string>`

- **API:** `GET /v1/servers/{id}`
- Poll every 5s until `server.status === "running"` and `server.public_net.ipv4.ip` is set
- Add 10s SSH warmup delay (matching GCP behavior)
- Return the IPv4 address

#### `startVm(instanceId, region): Promise<void>`

- **API:** `POST /v1/servers/{id}/actions/poweron`

#### `stopVm(instanceId, region): Promise<void>`

- **API:** `POST /v1/servers/{id}/actions/poweroff`

#### `deleteVm(instanceId, region): Promise<void>`

- **API:** `DELETE /v1/servers/{id}`

#### `getVmInfo(instanceId, region): Promise<VmInfo>`

- **API:** `GET /v1/servers/{id}`
- **Status mapping:**
  - `running` → `"running"`
  - `off` → `"stopped"`
  - `initializing` → `"creating"`
  - `starting`, `stopping`, `migrating`, `rebuilding` → `"creating"`
  - `deleting`, `unknown` → `"unknown"`
  - API errors → `"error"`

#### `listMachineTypes(region): Promise<Array<{id, description}>>`

Hardcoded list (matching the GCP pattern):

```typescript
[
  { id: "cx22",  description: "CX22 (2 vCPU, 4 GB) — ~€4/mo" },
  { id: "cx32",  description: "CX32 (4 vCPU, 8 GB) — ~€8/mo" },
  { id: "cx42",  description: "CX42 (8 vCPU, 16 GB) — ~€15/mo" },
  { id: "cx52",  description: "CX52 (16 vCPU, 32 GB) — ~€30/mo" },
  { id: "cpx21", description: "CPX21 (3 AMD vCPU, 4 GB) — ~€5/mo" },
  { id: "cpx31", description: "CPX31 (4 AMD vCPU, 8 GB) — ~€10/mo" },
  { id: "cpx41", description: "CPX41 (8 AMD vCPU, 16 GB) — ~€18/mo" },
  { id: "cax21", description: "CAX21 (4 Arm vCPU, 8 GB) — ~€6/mo" },
  { id: "cax31", description: "CAX31 (8 Arm vCPU, 16 GB) — ~€11/mo" },
]
```

> **Note on Arm (CAX) instances:** The setup scripts install Homebrew and OpenClaw. These need to work on aarch64. If OpenClaw doesn't support ARM, we should exclude CAX types. This needs verification before including them.

#### `listRegions(): Promise<Array<{id, description}>>`

Hardcoded list:

```typescript
[
  { id: "fsn1", description: "Falkenstein, DE" },
  { id: "nbg1", description: "Nuremberg, DE" },
  { id: "hel1", description: "Helsinki, FI" },
  { id: "ash",  description: "Ashburn, US" },
  { id: "hil",  description: "Hillsboro, US" },
]
```

#### Internal helper: `hetznerFetch(method, path, body?)`

A thin wrapper around `fetch` that:
- Reads `HETZNER_API_TOKEN` from env
- Sets `Authorization: Bearer {token}` header
- Sets `Content-Type: application/json`
- Throws on non-2xx responses with the error body
- Base URL: `https://api.hetzner.cloud/v1`

#### Internal helper: SSH key management

```typescript
let _sshKeyId: number | null = null;

async function ensureSshKey(publicKey: string): Promise<number> {
  if (_sshKeyId) return _sshKeyId;
  // Try to create; on 409 (uniqueness_error), list keys and find by fingerprint
  // Cache and return the ID
}
```

---

### Step 3: Register in provider factory (`src/lib/clouds/index.ts`)

Add Hetzner to `providerFactories`:

```typescript
hetzner: () => {
  const { HetznerCloudProvider } = require("./hetzner") as typeof import("./hetzner");
  return new HetznerCloudProvider();
},
```

The `listAvailableClouds()` entry already exists (line 24), gated on `HETZNER_API_TOKEN`.

---

### Step 4: Update constants (if needed)

`src/lib/constants.ts` already has:
- `CLOUD_NAMES.hetzner = "Hetzner Cloud"` (line 7)
- `CLOUD_SHORT_NAMES.hetzner = "Hetzner"` (line 12)

No changes needed here.

---

### Step 5: Add `HETZNER_API_TOKEN` to `.env.example`

Add the variable with an empty default so developers know it exists.

---

### Step 6: Hetzner-specific considerations

#### SSH key injection
Hetzner's API injects SSH keys for the **root** user by default. The VpsProvider connects as `openclaw` (via `ssh_user` in `vps_instances`). The setup script creates the `openclaw` user and sets up its SSH key. Two options:

1. **Option A (Recommended):** Create the VM with the SSH key for root, then the VpsProvider's first SSH connection goes in as root. The setup script creates the `openclaw` user, copies the SSH key, and disables root login. This matches the GCP flow where GCP injects the key for a specified user via metadata.

   **Issue:** VpsProvider connects as `vps.ssh_user` (default: `"openclaw"`). GCP injects the key for user `openclaw` via metadata (`openclaw:${spec.sshPublicKey}`). Hetzner injects for root.

   **Solution:** For Hetzner VMs, set `ssh_user = "root"` initially in the VPS instance record, or use cloud-init `user_data` to create the `openclaw` user with the SSH key before the VpsProvider connects.

2. **Option B:** Use Hetzner's `user_data` (cloud-init) to create the `openclaw` user and inject the SSH key, so by the time `waitForReady` returns, the `openclaw` user is ready for SSH.

**Recommendation:** Option B — use cloud-init `user_data` to create the `openclaw` user. This makes Hetzner behave identically to GCP from the VpsProvider's perspective (SSH as `openclaw` from the start). The cloud-init script would be:

```yaml
#cloud-config
users:
  - name: openclaw
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - {sshPublicKey}
```

#### Firewall
Hetzner VMs have all ports open by default. The setup script handles UFW hardening, so no additional Hetzner firewall API calls are needed. Optionally, a Hetzner Firewall could be created via API for defense-in-depth, but the UFW approach matches the existing security model.

#### Static IPs
Unlike GCP's ephemeral IPs that change on stop/start, Hetzner servers retain their IPv4 address across power cycles. This is actually simpler — the VpsProvider's `start()` method updates `external_ip` after each start (for GCP's changing IPs), which is harmless but unnecessary for Hetzner.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/clouds/hetzner.ts` | **Create** | Hetzner `CloudProvider` implementation (~150-200 lines) |
| `src/lib/clouds/index.ts` | **Modify** | Add `hetzner` to `providerFactories` (2 lines) |
| `.env.example` | **Modify** | Add `HETZNER_API_TOKEN` |

## Files That Need No Changes

| File | Reason |
|------|--------|
| `src/lib/clouds/types.ts` | Interface is generic enough |
| `src/lib/constants.ts` | Already has Hetzner entries |
| `src/lib/providers/vps-provider.ts` | Cloud-agnostic — uses `CloudProvider` interface |
| `src/lib/providers/vps-setup-script.ts` | Uses `apt` — works on Hetzner's Debian 12 |
| `src/lib/providers/ssh.ts` | Generic SSH — no cloud-specific code |
| `src/app/api/clouds/route.ts` | Dynamically lists available clouds |
| `src/app/api/tenants/route.ts` | Uses `getProvider()` — cloud-agnostic |
| `src/components/TenantForm.tsx` | Already shows all available clouds from API |
| Database / migrations | `vps_instances.cloud` is a free-form string, already supports "hetzner" |

---

## Open Questions

1. **ARM support:** Does OpenClaw + Homebrew work on aarch64? If not, exclude CAX machine types from the list.
2. **Hetzner API token scope:** What permissions does the token need? Server create/delete + SSH key management. Document the minimum required permissions.
3. **Rate limiting:** Hetzner API has rate limits (3600 requests/hour). For a fleet manager this should be fine, but worth noting.

---

## Testing Plan

1. Set `HETZNER_API_TOKEN` in `.env`
2. Verify Hetzner appears in the cloud dropdown (`GET /api/clouds`)
3. Create a test tenant with Hetzner — verify full provisioning stream completes
4. Test start/stop/restart lifecycle
5. Test delete/cleanup
6. Test error handling (invalid token, invalid region, etc.)

---

## Estimated Complexity

**Low-medium.** The cloud abstraction is clean and well-designed. The GCP implementation is ~190 lines. The Hetzner implementation should be ~150-200 lines (simpler API, no GCP auth complexity). The only nuance is SSH key injection (cloud-init user_data), which adds ~10 lines.
