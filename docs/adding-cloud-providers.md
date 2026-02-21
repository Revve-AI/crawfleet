# Adding Cloud Providers

Crawfleet ships with GCP support, but the cloud layer is designed to be pluggable. Any cloud that can create a Linux VM via API can be integrated.

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

Eight methods. The SSH setup, Cloudflare Tunnel creation, and OpenClaw installation are handled by the `VpsProvider` layer above. Your cloud provider only needs to create a VM and return an IP address for SSH access.

### Types

```typescript
interface VmSpec {
  name: string;           // "fleet-{slug}"
  machineType: string;    // "e2-small", "cx21", etc.
  region: string;         // "us-central1-a", "fsn1", etc.
  sshPublicKey: string;   // Injected for the 'openclaw' user
  startupScript?: string;
  tags?: string[];
}

interface VmInfo {
  instanceId: string;
  externalIp: string | null;
  status: "running" | "stopped" | "creating" | "error" | "unknown";
}
```

## Step-by-step guide

### 1. Write the implementation

Create a new file in `src/lib/clouds/` (e.g., `hetzner.ts`):

```typescript
import type { CloudProvider, VmSpec, VmInfo } from "./types";

export class HetznerCloudProvider implements CloudProvider {
  async createVm(spec: VmSpec): Promise<string> {
    // Create a server via the Hetzner API
    // Ensure spec.sshPublicKey is injected for user 'openclaw'
    // Return the server ID as a string
  }

  async waitForReady(instanceId: string, region: string, timeoutMs = 300_000): Promise<string> {
    // Poll until the server is running and has an IP
    // Return the external IP address
  }

  async startVm(instanceId: string, region: string): Promise<void> { /* power on */ }
  async stopVm(instanceId: string, region: string): Promise<void> { /* power off */ }
  async deleteVm(instanceId: string, region: string): Promise<void> { /* delete server */ }

  async getVmInfo(instanceId: string, region: string): Promise<VmInfo> {
    // Map the cloud provider's status to: running | stopped | creating | error | unknown
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

### 2. Register the provider

In `src/lib/clouds/index.ts`, add your provider to the map. Providers are enabled by environment variable — if the variable is not set, the provider is not available.

```typescript
import { HetznerCloudProvider } from "./hetzner";

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

### 4. Add the environment variable to `.env.example`

```bash
HETZNER_API_TOKEN=""
```

### 5. Test

1. Set the environment variable for your cloud provider
2. Run `pnpm dev`
3. Navigate to "New Tenant" — the new cloud provider should appear in the dropdown
4. Create a test tenant and verify the provisioning stream completes successfully

## VM requirements

Your provider must deliver a VM with:

- **Debian 12** or Ubuntu 22.04+ (the setup script uses `apt`)
- The fleet SSH key injected for user `openclaw`
- An external IP address accessible via SSH

Everything after VM creation — OS hardening, OpenClaw installation, Cloudflare Tunnel setup, and firewall configuration — is handled by `VpsProvider`. The cloud provider implementation does not need to manage any of that.
