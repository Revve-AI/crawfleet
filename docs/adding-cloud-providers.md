# Adding Cloud Providers

Crawfleet only ships with GCP today, but the cloud layer is pluggable. If you can create a Linux VM with an API, you can wire it up.

## The interface

Every cloud provider implements `CloudProvider` from `src/lib/clouds/types.ts`:

```typescript
interface CloudProvider {
  createVm(spec: VmSpec): Promise<string>;
  waitForReady(instanceId: string, region: string, timeoutMs?: number): Promise<string>;
  startVm(instanceId: string, region: string): Promise<void>;
  stopVm(instanceId: string, region: string): Promise<void>;
  deleteVm(instanceId: string, region: string): Promise<void>;
  getVmInfo(instanceId: string, region: string): Promise<VmInfo>;
  listMachineTypes(region: string): Promise<Array<{ id: string; description: string }>>;
  listRegions(): Promise<Array<{ id: string; description: string }>>;
}
```

That's it. Eight methods. The SSH setup, Cloudflare Tunnel creation, and OpenClaw installation are all handled by the `VpsProvider` layer above — your cloud just needs to make a VM and give Crawfleet an IP to SSH into.

### Types you'll use

```typescript
interface VmSpec {
  name: string;           // "fleet-{slug}"
  machineType: string;    // "e2-small", "cx21", whatever
  region: string;         // "us-central1-a", "fsn1", etc.
  sshPublicKey: string;   // Gets injected for the 'openclaw' user
  startupScript?: string;
  tags?: string[];
}

interface VmInfo {
  instanceId: string;
  externalIp: string | null;
  status: "running" | "stopped" | "creating" | "error" | "unknown";
}
```

## Adding a provider: step by step

### 1. Write the implementation

Create `src/lib/clouds/hetzner.ts` (or wherever your cloud is):

```typescript
import type { CloudProvider, VmSpec, VmInfo } from "./types";

export class HetznerCloudProvider implements CloudProvider {
  async createVm(spec: VmSpec): Promise<string> {
    // Hit the Hetzner API, create a server
    // Make sure spec.sshPublicKey gets injected for user 'openclaw'
    // Return the server ID as a string
  }

  async waitForReady(instanceId: string, region: string, timeoutMs = 300_000): Promise<string> {
    // Poll until it's running with an IP
    // Return the external IP
  }

  async startVm(instanceId: string, region: string): Promise<void> { /* power on */ }
  async stopVm(instanceId: string, region: string): Promise<void> { /* power off */ }
  async deleteVm(instanceId: string, region: string): Promise<void> { /* nuke it */ }

  async getVmInfo(instanceId: string, region: string): Promise<VmInfo> {
    // Map your cloud's status to: running | stopped | creating | error | unknown
  }

  async listMachineTypes(): Promise<Array<{ id: string; description: string }>> {
    return [
      { id: "cx22", description: "CX22 (2 vCPU, 4 GB) — ~$5/mo" },
      { id: "cx32", description: "CX32 (4 vCPU, 8 GB) — ~$9/mo" },
    ];
  }

  async listRegions(): Promise<Array<{ id: string; description: string }>> {
    return [
      { id: "fsn1", description: "Falkenstein, DE" },
      { id: "nbg1", description: "Nuremberg, DE" },
      { id: "hel1", description: "Helsinki, FI" },
    ];
  }
}
```

### 2. Register it

In `src/lib/clouds/index.ts`, add your provider to the map. Providers are enabled by env var — if the var isn't set, the provider doesn't show up. Nice and clean.

```typescript
import { HetznerCloudProvider } from "./hetzner";

// Hetzner: enabled when HETZNER_API_TOKEN is set
if (process.env.HETZNER_API_TOKEN) {
  providers.hetzner = () => new HetznerCloudProvider();
}
```

### 3. Add display names

In `src/lib/constants.ts`:

```typescript
export const CLOUD_NAMES: Record<string, string> = {
  gcp: "Google Cloud",
  hetzner: "Hetzner Cloud",
};
```

### 4. Add the env var to `.env.example`

```bash
HETZNER_API_TOKEN=""
```

### 5. Try it

1. Set your cloud's env var
2. `pnpm dev`
3. Go to "New Tenant" — your cloud shows up in the dropdown
4. Create a test tenant and watch the SSE stream

## The contract

Your provider just needs to hand off a VM with:

- **Debian 12** or Ubuntu 22.04+ (the setup script uses `apt`)
- The fleet SSH key injected for user `openclaw`
- An external IP so Crawfleet can SSH in during setup

Everything after that — OS hardening, OpenClaw install, Cloudflare Tunnel, firewall lockdown — is handled by `VpsProvider`. Your cloud code never touches any of that.
